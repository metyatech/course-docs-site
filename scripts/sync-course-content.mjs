import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRequiredContentSourceText, parseContentSource } from "./content-source.mjs";
import { resolveNextDistDirPath } from "./next-dist-dir.mjs";
import { redactGitError } from "./sanitize-git-error.mjs";

export { redactGitError };

const projectRoot = process.cwd();
const envFileRoot = path.resolve(projectRoot, process.env.COURSE_DOCS_ENV_FILE_DIR ?? ".");
const workRoot = path.join(projectRoot, ".course-content");
const cloneDir = path.join(workRoot, "repo");
const sourceStatePath = path.join(workRoot, "active-source.txt");

const readEnv = (filename) => {
  const envPath = path.join(envFileRoot, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return dotenv.parse(fs.readFileSync(envPath));
  } catch {
    return {};
  }
};

// Env precedence:
// - process.env (explicit) wins
// - later files override earlier files
const explicitEnvKeys = new Set(Object.keys(process.env));
const fileEnv = {
  ...readEnv(".env"),
  ...readEnv(".env.local"),
  ...readEnv(".env.course"),
  ...readEnv(".env.course.local"),
};
for (const [key, value] of Object.entries(fileEnv)) {
  if (!explicitEnvKeys.has(key)) {
    process.env[key] = value;
  }
}

const nextDistDirPath = resolveNextDistDirPath({ projectRoot, env: process.env });
const skipNextDistClear = process.env.COURSE_DOCS_SKIP_NEXT_DIST_CLEAR === "1";

const courseSourceText = getRequiredContentSourceText(process.env);
const courseSource = parseContentSource(courseSourceText);
const gitCommand = process.env.COURSE_DOCS_GIT_COMMAND || "git";
const gitCommandPrefix = process.env.COURSE_DOCS_GIT_SCRIPT
  ? [process.env.COURSE_DOCS_GIT_SCRIPT]
  : [];

// The script only ever talks to github.com. We embed the auth in the URL
// (e.g. `https://x-access-token:<token>@github.com/owner/repo.git`); git's
// own URL parser strips the userinfo from any error message it emits, so the
// token never leaks to the terminal even before redaction runs. This
// matches the on-the-wire behavior the embedded URL has always had: git
// base64-encodes the userinfo and sends it as `Authorization: basic <b64>`.
const isWindows = process.platform === "win32";

// Build a short-lived, isolated git config + auth context. The returned
// `authEnv` is meant to be spread into `spawnSync` so that the spawned git
// process is immune to:
//   1. The workspace's local `.git/config` (which `actions/checkout@v6`
//      writes an `includeIf.gitdir:...` into, pointing at a temp file
//      containing the run-scoped `GITHUB_TOKEN` `extraheader`). We bypass
//      it by setting `GIT_DIR` to a fresh, empty directory under
//      `os.tmpdir()`. With no `.git/config` to read, the `includeIf:`
//      never fires.
//   2. The user's `~/.gitconfig`. We bypass it by pointing
//      `GIT_CONFIG_GLOBAL` at a fresh, empty file we just created in the
//      OS temp dir.
//   3. The system gitconfig. We bypass it by setting
//      `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_SYSTEM` to the NUL device
//      (`NUL` on Windows, `/dev/null` on Linux) as belt-and-suspenders.
//
// The auth is URL-embedded (not delivered via `extraheader`) for two
// reasons:
//   - `GIT_CONFIG_PARAMETERS` is rejected by git 2.54.0 with
//     `error: bogus format in GIT_CONFIG_PARAMETERS` on the CI runner.
//   - The URL form is git's native, version-stable way to deliver basic
//     auth to a single HTTP operation, and git's URL parser already strips
//     the userinfo from error messages, so the token does not reach stderr
//     even without redaction. `redactGitError` is preserved as
//     defense-in-depth in case a future git version regresses on the
//     userinfo-stripping behavior.
//
// No persistent state is mutated: both temp dirs we create live under
// `os.tmpdir()` and are removed in `disposeIsolatedGitAuthContext`. We
// never write to the workspace's `.git/config`, the user's `~/.gitconfig`,
// the system gitconfig, or any file outside `os.tmpdir()`.
const createIsolatedGitAuthContext = (_token) => {
  // The "config dir" holds the empty GIT_CONFIG_GLOBAL file. We use
  // mkdtempSync so the directory is created atomically with a unique
  // suffix and we own its lifecycle.
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "course-docs-git-"));
  const globalConfigPath = path.join(configDir, "gitconfig");
  // Touch the file as an empty config so GIT_CONFIG_GLOBAL can be resolved.
  fs.writeFileSync(globalConfigPath, "");
  // The "empty git dir" is used as the value of GIT_DIR. It must exist on
  // disk at the time of the spawn so git can chdir into it (git stats
  // GIT_DIR before doing anything else). An empty directory is fine: it
  // is a valid (empty) git repo, so the includeIf.gitdir rules in the
  // workspace's `.git/config` are never matched.
  const emptyGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "course-docs-empty-gitdir-"));
  const authEnv = {
    GIT_DIR: emptyGitDir,
    GIT_CONFIG_GLOBAL: globalConfigPath,
    // On Windows, `GIT_CONFIG_NOSYSTEM=1` is honored by Git for Windows, and
    // `GIT_CONFIG_SYSTEM=NUL` is the device path that makes any residual
    // system-config lookup a no-op. Setting both is the most defensive option
    // and works for every supported runner.
    GIT_CONFIG_SYSTEM: isWindows ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  return { configDir, emptyGitDir, globalConfigPath, authEnv };
};

const disposeIsolatedGitAuthContext = ({ configDir, emptyGitDir } = {}) => {
  for (const target of [configDir, emptyGitDir]) {
    if (!target) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // best-effort cleanup; never let cleanup mask the original error
    }
  }
};

// `runGit` is the only place that knows about the per-run git config
// isolation. Every other call site (run, runCapture) forwards the authEnv it
// was given.
const runGit = (args, options = {}) => {
  const { authEnv, ...spawnOptions } = options;
  const env = authEnv ? { ...process.env, ...authEnv } : process.env;
  return spawnSync(gitCommand, [...gitCommandPrefix, ...args], { ...spawnOptions, env });
};

const requiredPaths = [
  { label: "content", rel: "content" },
  { label: "site.config.ts", rel: "site.config.ts" },
];

// Format a non-zero exit as an Error whose `.message` includes the command
// name, exit code, and the redacted stderr. The redactor is applied even
// when `stderr` is empty (as a no-op) so the helper stays a single funnel
// for all git failures.
const buildCommandFailureError = ({ command, args, status, stderr, token }) => {
  const redactedStderr = stderr ? redactGitError(stderr, { token }) : "";
  const commandLabel = args && args.length > 0 ? `${command} ${args.join(" ")}` : command;
  if (redactedStderr.trim()) {
    return new Error(`${commandLabel} failed with exit code ${status}:\n${redactedStderr.trim()}`);
  }
  return new Error(`${commandLabel} exited with code ${status}`);
};

// `run` is used for long-lived commands where we want the user to see live
// progress (e.g. `git clone`). We keep stdout inherited so the user sees the
// progress bar, but we pipe stderr so we can redact it on failure and
// prevent the authed URL (or the token) from leaking into the terminal.
const run = (command, args, options = {}) => {
  const { authEnv, captureStderr = true } = options;
  const stdio = captureStderr ? ["inherit", "inherit", "pipe"] : "inherit";
  const result =
    command === gitCommand
      ? runGit(args, { authEnv, stdio })
      : spawnSync(command, args, { stdio, env: process.env });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = captureStderr ? (result.stderr ?? "") : "";
    // Pull the token from the calling environment so the literal value can
    // be scrubbed if it ever appears in stderr. The base64-encoded
    // Authorization header is also covered by the header scrubber in
    // `redactGitError`. An empty token makes the literal scrubber a no-op
    // while the URL and header scrubbers still run.
    const token = authEnv ? (process.env.GH_TOKEN?.trim() ?? "") : "";
    // Surface the redacted failure to the parent terminal so the user still
    // sees something went wrong, then throw a structured error.
    if (stderr) {
      const redacted = redactGitError(stderr, { token });
      if (redacted.trim()) {
        process.stderr.write(`${redacted.trim()}\n`);
      }
    }
    throw buildCommandFailureError({
      command,
      args,
      status: result.status,
      stderr,
      token,
    });
  }
};

// `runCapture` is used for short, output-only commands. stderr is always
// captured so we can include it in the failure message after redaction.
const runCapture = (command, args, options = {}) => {
  const { authEnv } = options;
  const result =
    command === gitCommand
      ? runGit(args, { authEnv, encoding: "utf8" })
      : spawnSync(command, args, { encoding: "utf8", env: process.env });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = result.stderr ?? "";
    const token = authEnv ? (process.env.GH_TOKEN?.trim() ?? "") : "";
    throw buildCommandFailureError({
      command,
      args,
      status: result.status,
      stderr,
      token,
    });
  }
  return result.stdout ?? "";
};

const rmIfExists = (targetPath) => {
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
      return;
    }
  } catch {
    // ignore
  }
  fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
};

const readTextIfExists = (p) => {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
};

const writeTextFile = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const ensureRealDirectory = (dirPath) => {
  try {
    const st = fs.lstatSync(dirPath);
    if (!st.isDirectory() || st.isSymbolicLink()) {
      rmIfExists(dirPath);
    }
  } catch {
    // ignore
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

const normalizeRelativePath = (relativePath) => relativePath.split(path.sep).join("/");

const copyFile = (from, to) => {
  try {
    const st = fs.lstatSync(to);
    if (st.isDirectory() || st.isSymbolicLink()) {
      rmIfExists(to);
    }
  } catch {
    // ignore
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

const mirrorPath = (from, to, options) => {
  const st = fs.lstatSync(from);

  if (st.isSymbolicLink()) {
    const resolved = fs.realpathSync(from);
    const resolvedStat = fs.statSync(resolved);
    if (resolvedStat.isDirectory()) {
      mirrorDir(resolved, to, { ...options, rootFrom: options.rootFrom ?? from });
      return;
    }
    if (resolvedStat.isFile()) {
      copyFile(resolved, to);
      return;
    }
    throw new Error(`Unsupported symlink target in content repo: ${from}`);
  }

  if (st.isDirectory()) {
    mirrorDir(from, to, { ...options, rootFrom: options.rootFrom ?? from });
    return;
  }

  if (st.isFile()) {
    copyFile(from, to);
    return;
  }

  throw new Error(`Unsupported filesystem entry in content repo: ${from}`);
};

const mirrorDir = (from, to, options = {}) => {
  const { shouldSkip } = options;
  const rootFrom = options.rootFrom ?? from;
  ensureRealDirectory(to);

  const sourceEntries = fs.readdirSync(from, { withFileTypes: true });
  const keptNames = new Set();

  for (const entry of sourceEntries) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootFrom, sourcePath));

    if (shouldSkip?.({ name: entry.name, sourcePath, targetPath, relativePath })) {
      continue;
    }
    keptNames.add(entry.name);
  }

  for (const entry of fs.readdirSync(to, { withFileTypes: true })) {
    if (entry.name === ".keep") {
      continue;
    }
    if (!keptNames.has(entry.name)) {
      rmIfExists(path.join(to, entry.name));
    }
  }

  for (const entry of sourceEntries) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootFrom, sourcePath));

    if (shouldSkip?.({ name: entry.name, sourcePath, targetPath, relativePath })) {
      continue;
    }

    mirrorPath(sourcePath, targetPath, { rootFrom, shouldSkip });
  }
};

const syncDirectory = ({ from, to, shouldSkip }) => {
  if (!fs.existsSync(from)) {
    rmIfExists(to);
    ensureRealDirectory(to);
    fs.writeFileSync(path.join(to, ".keep"), "");
    return;
  }

  mirrorDir(from, to, { shouldSkip });
  fs.writeFileSync(path.join(to, ".keep"), "");
};

const resolveRemoteHeadSha = ({ repoUrl, ref, authEnv }) => {
  const stdout = runCapture(gitCommand, ["ls-remote", repoUrl, ref], { authEnv });
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    throw new Error(`Unable to resolve remote ref ${ref} from ${repoUrl}`);
  }

  const [sha] = line.split(/\s+/u);
  if (!sha) {
    throw new Error(`Unable to parse remote ref ${ref} from ${repoUrl}`);
  }
  return sha;
};

const hasGitClone = (dirPath) => fs.existsSync(path.join(dirPath, ".git"));

let sourceRoot = cloneDir;
let activeSourceId = "";

const previousSourceId = readTextIfExists(sourceStatePath);

if (courseSource.kind === "local") {
  sourceRoot = path.resolve(projectRoot, courseSource.localDir);
  activeSourceId = `dir:${sourceRoot}`;
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`COURSE_CONTENT_SOURCE points to a non-directory path: ${sourceRoot}`);
  }
} else {
  fs.mkdirSync(workRoot, { recursive: true });
  const ghToken = process.env.GH_TOKEN?.trim();
  // When GH_TOKEN is set, embed it in the URL so git sends the run-scoped
  // PAT as `Authorization: basic <b64>`. Git's URL parser strips the
  // userinfo from any error message it emits, so the token does not leak
  // to stderr even before redaction runs. For the public-repo path (no
  // GH_TOKEN), use the canonical non-authed URL.
  const repoUrl = ghToken
    ? `https://x-access-token:${ghToken}@github.com/${courseSource.repo}.git`
    : `https://github.com/${courseSource.repo}.git`;
  const authContext = ghToken ? createIsolatedGitAuthContext(ghToken) : null;
  const authEnv = authContext?.authEnv;
  try {
    const headSha = resolveRemoteHeadSha({ repoUrl, ref: courseSource.ref, authEnv });
    activeSourceId = `repo:${courseSource.repo}#${courseSource.ref}@${headSha}`;

    if (previousSourceId !== activeSourceId || !hasGitClone(cloneDir)) {
      rmIfExists(cloneDir);
      run(gitCommand, ["clone", "--depth", "1", "--branch", courseSource.ref, repoUrl, cloneDir], {
        authEnv,
      });
    }
  } finally {
    if (authContext) {
      disposeIsolatedGitAuthContext(authContext);
    }
  }
}

if (!activeSourceId) {
  activeSourceId = sourceRoot ? `dir:${sourceRoot}` : "unknown";
}

if (!skipNextDistClear && previousSourceId && previousSourceId !== activeSourceId) {
  // Switching content can change the MDX tree and page-map.
  // Clear Next build artifacts to avoid cross-course stale runtime chunks.
  rmIfExists(nextDistDirPath);
}
writeTextFile(sourceStatePath, activeSourceId);

for (const required of requiredPaths) {
  const resolved = path.join(sourceRoot, required.rel);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing required path in content repo: ${required.label} (${required.rel})`);
  }
}

const contentFrom = path.join(sourceRoot, "content");
const contentTo = path.join(projectRoot, "content");
syncDirectory({
  from: contentFrom,
  to: contentTo,
  shouldSkip: ({ name }) => name === "_pagefind",
});

const siteConfigFrom = path.join(sourceRoot, "site.config.ts");
const siteConfigTo = path.join(projectRoot, "site.config.ts");
copyFile(siteConfigFrom, siteConfigTo);

const publicFrom = path.join(sourceRoot, "public");
const publicTo = path.join(projectRoot, "public");
syncDirectory({
  from: publicFrom,
  to: publicTo,
  shouldSkip: ({ relativePath }) => relativePath === "student-works",
});

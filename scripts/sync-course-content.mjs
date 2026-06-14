import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { getRequiredContentSourceText, parseContentSource } from "./content-source.mjs";
import {
  buildScrubbedIsolatedEnv,
  createIsolatedGitAuthContext,
  disposeIsolatedGitAuthContext,
} from "./git-auth-context.mjs";
import { normalizeOriginUrl } from "./git-origin-normalize.mjs";
import { parseLsRemoteObjectId } from "./git-remote-ref.mjs";
import { resolveNextDistDirPath } from "./next-dist-dir.mjs";
import { redactArgsForError, redactGitError } from "./sanitize-git-error.mjs";

export { redactArgsForError, redactGitError };
export { normalizeOriginUrl };

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

// The script only ever talks to github.com. On the private path (when
// `GH_TOKEN` is set) we use the canonical
// `https://github.com/<owner>/<repo>.git` URL for every git invocation
// and deliver the PAT to the spawned git process via the per-context
// `authEnv` returned by `createIsolatedGitAuthContext`. The token
// never appears in argv, stdout, stderr, or any tracked file.
//
// Isolation is provided by four independent layers so that an
// `includeIf:` leftover from `actions/checkout@v6` (or any stale
// `~/.gitconfig`) cannot leak a `GITHUB_TOKEN` `extraheader` into the
// spawned process:
//
//   1. The spawned git process runs with `cwd` set to a fresh empty
//      tmpdir created via `fs.mkdtempSync(os.tmpdir() + ...)`. With no
//      `.git/` in the cwd, no `includeIf.gitdir:` rule from the
//      workspace's `.git/config` can match.
//   2. `GIT_CONFIG_GLOBAL` is set to an EMPTY file in `os.tmpdir()` so
//      Git's global gitconfig (the fallback for "no
//      `GIT_CONFIG_GLOBAL`") is an empty file we control, not the
//      user's `~/.gitconfig`. The empty file is removed in
//      `disposeIsolatedGitAuthContext`.
//   3. `GIT_CONFIG_NOSYSTEM=1` is set so Git does not read the system
//      gitconfig, and `GIT_CONFIG_SYSTEM` is pointed at the OS-specific
//      null device (`NUL` on Windows, `/dev/null` elsewhere) so any code
//      path that ignores `GIT_CONFIG_NOSYSTEM` still reads an empty
//      file.
//   4. We explicitly scrub the inherited parent env of every Git
//      override variable (`GIT_DIR`, `GIT_WORK_TREE`,
//      `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, all
//      `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` by pattern,
//      `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`)
//      and install the auth triple (`GIT_CONFIG_COUNT` /
//      `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` plus
//      `GIT_TERMINAL_PROMPT=0` and the new global/system overrides) on
//      top of the scrubbed env, so the spawned git process has exactly
//      the Authorization header we want and nothing else.
//
// On the public path (no `GH_TOKEN`) we skip all four layers: we use
// the canonical URL, do not create an auth context, do not override
// `cwd`, and let the spawned git process inherit the parent env
// unchanged. The `runGit` / `run` / `runCapture` helpers accept an
// explicit `cwd` and `authEnv`; when neither is set, the spawn is a
// plain `spawnSync(git, args)`.
//
// The private-path flow runs in this exact order so that the only
// place a credentialed URL can land on disk is the (freshly created)
// clone directory's `.git/config`, which the production
// `normalizeOriginUrl` helper then rewrites in place:
//
//   1. Build the canonical URL and the active-source-id skeleton from
//      `courseSource.repo` and `courseSource.ref`.
//   2. Inspect the existing clone directory. If it exists and its
//      `previousSourceId` matches the would-be active source id, call
//      `normalizeOriginUrl` to repair any leftover credentialed origin
//      URL BEFORE any network access. If it exists and its
//      `previousSourceId` does NOT match (different repo or ref), `rm`
//      the clone directory before network access so a credentialed
//      `.git/config` from a different content source can never be
//      observed. If it does not exist, do nothing.
//   3. Run `git ls-remote` against the canonical URL. The output is
//      parsed by `parseLsRemoteObjectId`, which enforces a 40-hex
//      (SHA-1) or 64-hex (SHA-256) prefix followed by whitespace.
//      Empty stdout throws "Unable to resolve remote ref ...";
//      malformed stdout throws "Unable to parse remote ref ...". Both
//      error messages mention only the canonical URL, never the
//      malformed line.
//   4. If a clone is needed, run `git clone`.
//   5. After the clone, call `normalizeOriginUrl` again as a
//      defense-in-depth repair. The clone's `.git/config` is rewritten
//      to contain exactly one canonical `url = <canonicalUrl>` line
//      under `[remote "origin"]`, with every other `url =` line in any
//      origin section removed, and a postcondition assertion ensures
//      the on-disk file contains no `x-access-token:` prefix and no
//      `@github.com` userinfo in any origin URL value.

const runGit = (args, options = {}) => {
  const { authEnv, cwd, ...spawnOptions } = options;
  const env = authEnv ? buildScrubbedIsolatedEnv(authEnv) : process.env;
  const resolvedCwd = cwd ?? process.cwd();
  return spawnSync(gitCommand, [...gitCommandPrefix, ...args], {
    ...spawnOptions,
    env,
    cwd: resolvedCwd,
  });
};

const requiredPaths = [
  { label: "content", rel: "content" },
  { label: "site.config.ts", rel: "site.config.ts" },
];

// Format a non-zero exit as an Error whose `.message` includes the
// command name, exit code, and the redacted stderr. The redactor is
// applied even when `stderr` is empty (as a no-op) so the helper stays
// a single funnel for all git failures. The argv is passed through
// `redactArgsForError` before being joined into the command label, so
// an authed URL or `x-access-token:...` value that was ever passed on
// the command line can never appear in the user-visible command
// label.
const buildCommandFailureError = ({ command, args, status, stderr, token }) => {
  const redactedStderr = stderr ? redactGitError(stderr, { token }) : "";
  const redactedArgs = redactArgsForError(args);
  const commandLabel = redactedArgs.length > 0 ? `${command} ${redactedArgs.join(" ")}` : command;
  if (redactedStderr.trim()) {
    return new Error(`${commandLabel} failed with exit code ${status}:\n${redactedStderr.trim()}`);
  }
  return new Error(`${commandLabel} exited with code ${status}`);
};

// `run` is used for long-lived commands where we want the user to see
// live progress (e.g. `git clone`). We keep stdout inherited so the
// user sees the progress bar, but we pipe stderr so we can redact it
// on failure and prevent the authed URL (or the token) from leaking
// into the terminal.
const run = (command, args, options = {}) => {
  const { authEnv, cwd, captureStderr = true } = options;
  const stdio = captureStderr ? ["inherit", "inherit", "pipe"] : "inherit";
  const result =
    command === gitCommand
      ? runGit(args, { authEnv, cwd, stdio })
      : spawnSync(command, args, { stdio, env: process.env, cwd: cwd ?? process.cwd() });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    const stderr = captureStderr ? (result.stderr ?? "") : "";
    // Pull the token from the calling environment so the literal
    // value can be scrubbed if it ever appears in stderr. The
    // base64-encoded Authorization header is also covered by the
    // header scrubber in `redactGitError`. An empty token makes the
    // literal scrubber a no-op while the URL and header scrubbers
    // still run.
    const token = authEnv ? (process.env.GH_TOKEN?.trim() ?? "") : "";
    // Surface the redacted failure to the parent terminal so the
    // user still sees something went wrong, then throw a structured
    // error.
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

// `runCapture` is used for short, output-only commands. stderr is
// always captured so we can include it in the failure message after
// redaction.
const runCapture = (command, args, options = {}) => {
  const { authEnv, cwd } = options;
  const result =
    command === gitCommand
      ? runGit(args, { authEnv, cwd, encoding: "utf8" })
      : spawnSync(command, args, { encoding: "utf8", env: process.env, cwd: cwd ?? process.cwd() });
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

const hasGitClone = (dirPath) => fs.existsSync(path.join(dirPath, ".git"));

// `resolveRemoteHeadSha` runs `git ls-remote` against the canonical
// URL, parses the strict first line via `parseLsRemoteObjectId`, and
// throws a user-facing error that mentions only the canonical URL —
// never the malformed line. The `displayUrl` parameter is always
// passed as the canonical form by the caller, so the same error path
// works for both the public and private paths.
const resolveRemoteHeadSha = ({ repoUrl, displayUrl, ref, authEnv, cwd }) => {
  const safeDisplayUrl = displayUrl ?? repoUrl;
  const stdout = runCapture(gitCommand, ["ls-remote", repoUrl, ref], { authEnv, cwd });
  const parsed = parseLsRemoteObjectId(stdout);
  if (parsed.kind === "empty") {
    throw new Error(`Unable to resolve remote ref ${ref} from ${safeDisplayUrl}`);
  }
  if (parsed.kind === "malformed") {
    // `firstLine` is intentionally NOT included in the error message:
    // a malformed stdout is attacker-controllable input. The
    // canonical URL is the only thing we know is safe to echo.
    throw new Error(`Unable to parse remote ref ${ref} from ${safeDisplayUrl}`);
  }
  return parsed.sha;
};

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
  // The canonical URL is used for every git invocation on both the
  // private and the public path. The token is never URL-embedded; on
  // the private path it is delivered to the spawned git process via
  // the auth triple returned by `createIsolatedGitAuthContext`.
  // `displayUrl` is what we use in user-facing error messages so a
  // failed `ls-remote` never echoes the credentialed URL.
  const canonicalUrl = `https://github.com/${courseSource.repo}.git`;
  const displayUrl = canonicalUrl;
  const authContext = ghToken ? createIsolatedGitAuthContext(ghToken) : null;
  const authEnv = authContext?.authEnv;
  const isolatedCwd = authContext?.cwd;
  try {
    // Step 1: compute the active-source-id SKELETON before any
    // network access. The head SHA is filled in by the `git ls-remote`
    // call below, but the (repo, ref) portion is what we compare
    // against the persisted `previousSourceId`. We use this skeleton
    // to decide whether the existing clone is reusable.
    const activeIdSkeleton = `repo:${courseSource.repo}#${courseSource.ref}@`;

    // Step 2: inspect the existing clone BEFORE any network access.
    // The existing `.git/config` may carry a credentialed origin URL
    // left over from a previous run; the `previousSourceId` check
    // tells us whether that legacy config is still relevant to the
    // current invocation.
    if (hasGitClone(cloneDir)) {
      if (previousSourceId && previousSourceId.startsWith(activeIdSkeleton)) {
        // Same repo + ref. The persisted config is the one we want
        // to read content from, but it may still carry a stale
        // credentialed origin URL (from a previous run that
        // URL-embedded the token). Repair it BEFORE we touch the
        // network so any later read of `.git/config` cannot observe
        // a credentialed value.
        normalizeOriginUrl(cloneDir, canonicalUrl);
      } else {
        // Different repo / ref / unknown state. The persisted
        // `.git/config` cannot be trusted (it is from a different
        // source, or we have never recorded an `active-source.txt`).
        // Remove the directory so the post-clone write is the only
        // place a URL can end up on disk.
        rmIfExists(cloneDir);
      }
    }

    // Step 3: network access. The strict parser enforces 40-hex /
    // 64-hex object ids and emits canonical-URL-only error messages.
    const headSha = resolveRemoteHeadSha({
      repoUrl: canonicalUrl,
      displayUrl,
      ref: courseSource.ref,
      authEnv,
      cwd: isolatedCwd,
    });
    activeSourceId = `${activeIdSkeleton}${headSha}`;

    // Step 4: clone if needed.
    if (!hasGitClone(cloneDir)) {
      run(
        gitCommand,
        ["clone", "--depth", "1", "--branch", courseSource.ref, canonicalUrl, cloneDir],
        { authEnv, cwd: isolatedCwd },
      );
    }

    // Step 5: post-clone defense-in-depth. Even on the reuse path the
    // clone's `.git/config` may have been written by a different
    // process; rewriting it here ensures the on-disk state always
    // matches the canonical URL.
    normalizeOriginUrl(cloneDir, canonicalUrl);
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

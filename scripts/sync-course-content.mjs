import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRequiredContentSourceText, parseContentSource } from "./content-source.mjs";
import { resolveNextDistDirPath } from "./next-dist-dir.mjs";
import { redactArgsForError, redactGitError } from "./sanitize-git-error.mjs";

export { redactArgsForError, redactGitError };

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
// `https://github.com/<owner>/<repo>.git` URL for every git invocation and
// deliver the PAT to the spawned git process via
// `GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`
// + `GIT_CONFIG_VALUE_0=AUTHORIZATION: basic <base64(x-access-token:PAT)>`.
// The token never appears in argv, stdout, stderr, or any tracked file.
//
// Isolation is provided by three independent layers so that an `includeIf:`
// leftover from `actions/checkout@v6` (or any stale `~/.gitconfig`) cannot
// leak a `GITHUB_TOKEN` `extraheader` into the spawned process:
//
//   1. We run the spawned git process with `cwd` set to a fresh empty
//      tmpdir created via `fs.mkdtempSync(os.tmpdir() + ...)`. With no
//      `.git/` in the cwd, no `includeIf.gitdir:` rule from the workspace's
//      `.git/config` can match.
//   2. We explicitly scrub the inherited parent env of every Git
//      override variable that could carry configuration from the parent
//      shell or from `actions/checkout`. The scrubbed list is
//      `GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_PARAMETERS`,
//      `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_*`, `GIT_CONFIG_VALUE_*`,
//      `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`.
//   3. We install the `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` /
//      `GIT_CONFIG_VALUE_0` triple (and `GIT_TERMINAL_PROMPT=0` to make
//      any credential-prompt path a hard error rather than a hang) on
//      top of the scrubbed env, so the spawned git process has exactly
//      the Authorization header we want and nothing else.
//
// On the public path (no `GH_TOKEN`) we skip all three layers: we use the
// canonical URL, do not create an auth context, do not override `cwd`,
// and let the spawned git process inherit the parent env unchanged. The
// `runGit` / `run` / `runCapture` helpers accept an explicit `cwd` and
// `authEnv`; when neither is set, the spawn is a plain
// `spawnSync(git, args)`.
//
// After every successful `git clone` (and on the existing-clone reuse
// path, before we read any file from the clone) we defensively rewrite
// `.course-content/repo/.git/config` `[remote "origin"]` `url = ...` to
// the canonical URL via `normalizeOriginUrl`. This is belt-and-suspenders
// for the case where the previously cloned workspace was checked out with
// a credentialed URL (e.g. by an older release of this script that
// URL-embedded the token) and is being reused.

// Build a short-lived, isolated auth context for the spawned git process
// when `GH_TOKEN` is present. The returned `cwd` is a fresh, empty tmpdir
// that the spawned process should chdir into; the returned `authEnv` is
// meant to be merged on top of a scrubbed `process.env` (see `runGit`).
// No persistent state is mutated: the tmpdir lives under `os.tmpdir()` and
// is removed in `disposeIsolatedGitAuthContext`. We never write to the
// workspace's `.git/config`, the user's `~/.gitconfig`, the system
// gitconfig, or any file outside `os.tmpdir()`.
const createIsolatedGitAuthContext = (token) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "course-docs-git-cwd-"));
  const headerValue = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const authEnv = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: headerValue,
    // Disable interactive credential prompts so any unexpected auth
    // challenge fails fast rather than hanging CI.
    GIT_TERMINAL_PROMPT: "0",
  };
  return { cwd, authEnv };
};

const disposeIsolatedGitAuthContext = ({ cwd } = {}) => {
  if (!cwd) return;
  try {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // best-effort cleanup; never let cleanup mask the original error
  }
};

// Variables that must be scrubbed from the inherited parent env before we
// install the isolated `GIT_CONFIG_*` triple. Anything on this list is
// either a Git override variable that could carry auth/credential material
// from the parent shell or a previous `actions/checkout` step, or a
// multi-value `GIT_CONFIG_*` form that would silently combine with our
// injected `KEY_0` / `VALUE_0` and either prepend a stale `extraheader`
// (the bug we are defending against) or override it (which would silently
// drop our Authorization header).
const SCRUBBED_GIT_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
];

const SCRUBBED_GIT_ENV_KEY_PATTERN = /^GIT_CONFIG_(KEY|VALUE)_\d+$/u;

const buildScrubbedIsolatedEnv = (authEnv) => {
  const env = { ...process.env };
  for (const key of SCRUBBED_GIT_ENV_KEYS) {
    delete env[key];
  }
  // Multi-value GIT_CONFIG_KEY_<n> / GIT_CONFIG_VALUE_<n> entries are
  // matched by pattern (the count is variable). We only need to scrub
  // numeric suffixes that overlap with our injected index 0.
  for (const key of Object.keys(env)) {
    if (SCRUBBED_GIT_ENV_KEY_PATTERN.test(key)) {
      delete env[key];
    }
  }
  if (authEnv) {
    Object.assign(env, authEnv);
  }
  return env;
};

// `runGit` is the only place that knows about the per-run git config
// isolation. Every other call site (run, runCapture) forwards the
// `authEnv` and `cwd` it was given. When `authEnv` is provided, the
// spawned process is run with the scrubbed isolated env and `cwd`; when
// it is not, the spawned process inherits the parent env and `cwd`.
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

// Format a non-zero exit as an Error whose `.message` includes the command
// name, exit code, and the redacted stderr. The redactor is applied even
// when `stderr` is empty (as a no-op) so the helper stays a single funnel
// for all git failures. The argv is passed through `redactArgsForError`
// before being joined into the command label, so an authed URL or
// `x-access-token:...` value that was ever passed on the command line can
// never appear in the user-visible command label.
const buildCommandFailureError = ({ command, args, status, stderr, token }) => {
  const redactedStderr = stderr ? redactGitError(stderr, { token }) : "";
  const redactedArgs = redactArgsForError(args);
  const commandLabel = redactedArgs.length > 0 ? `${command} ${redactedArgs.join(" ")}` : command;
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

const resolveRemoteHeadSha = ({ repoUrl, displayUrl, ref, authEnv, cwd }) => {
  const safeDisplayUrl = displayUrl ?? repoUrl;
  const stdout = runCapture(gitCommand, ["ls-remote", repoUrl, ref], { authEnv, cwd });
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    throw new Error(`Unable to resolve remote ref ${ref} from ${safeDisplayUrl}`);
  }

  const [sha] = line.split(/\s+/u);
  if (!sha) {
    throw new Error(`Unable to parse remote ref ${ref} from ${safeDisplayUrl}`);
  }
  return sha;
};

const hasGitClone = (dirPath) => fs.existsSync(path.join(dirPath, ".git"));

// Match a github.com userinfo (`https://<anything-without-/, @, or quote>@github.com`).
// Used to reject any value that smuggles credentials into the persisted
// `remote.origin.url` even when the rest of the value looks like a canonical
// URL.
const CREDENTIALED_GITHUB_URL_PATTERN = /:\/\/[^/\s@"]*@github\.com/iu;
const X_ACCESS_TOKEN_PATTERN = /x-access-token:/iu;
const NEWLINE_PATTERN = /[\r\n]/u;

// Reject a `remote.origin.url` value that contains anything that smells
// like a credential (userinfo, `x-access-token:` prefix, or an embedded
// newline that could break out of the `url = <value>` line). The error
// message is constructed from a fixed phrasing + the caller-supplied
// `canonicalUrl`; callers MUST validate `canonicalUrl` up front so that
// it is safe to echo. We never include `value` in the message because
// `value` is the untrusted thing we are rejecting.
const assertSafeOriginUrlValue = (value, canonicalUrl) => {
  if (typeof value !== "string" || !value) {
    throw new Error(
      `Refusing to write an empty remote.origin.url; expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (CREDENTIALED_GITHUB_URL_PATTERN.test(value)) {
    throw new Error(
      `Refusing to write a remote.origin.url that contains userinfo; expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (X_ACCESS_TOKEN_PATTERN.test(value)) {
    throw new Error(
      `Refusing to write a remote.origin.url that contains the x-access-token prefix; expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (NEWLINE_PATTERN.test(value)) {
    throw new Error(
      `Refusing to write a remote.origin.url that contains a newline; expected the canonical URL ${canonicalUrl}.`,
    );
  }
};

// Reject a canonicalUrl that itself looks credentialed. The message here
// intentionally does NOT echo the offending value: by the time we detect
// this, we have not established that the value is safe to print.
const assertSafeCanonicalUrl = (value) => {
  if (typeof value !== "string" || !value) {
    throw new Error("normalizeOriginUrl requires a non-empty canonicalUrl argument.");
  }
  if (CREDENTIALED_GITHUB_URL_PATTERN.test(value)) {
    throw new Error(
      "normalizeOriginUrl canonicalUrl must not contain userinfo (e.g. x-access-token:...).",
    );
  }
  if (X_ACCESS_TOKEN_PATTERN.test(value)) {
    throw new Error("normalizeOriginUrl canonicalUrl must not contain the x-access-token prefix.");
  }
  if (NEWLINE_PATTERN.test(value)) {
    throw new Error("normalizeOriginUrl canonicalUrl must not contain a newline.");
  }
};

// Resolve the path to the cloned repository's `.git/config` file. For a
// regular `git clone` the `.git` entry is a directory; for linked worktrees
// it can be a file. In either case the on-disk config file lives at
// `<cloneDir>/.git/config`.
const resolveClonedRepoConfigPath = (cloneDirPath, canonicalUrl) => {
  const gitEntry = path.join(cloneDirPath, ".git");
  let stat;
  try {
    stat = fs.lstatSync(gitEntry);
  } catch (error) {
    throw new Error(
      `Cannot read cloned repo config at ${path.join(cloneDirPath, ".git", "config")}: ${
        error && error.code ? error.code : "unknown error"
      }. Expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (stat.isDirectory()) {
    return path.join(gitEntry, "config");
  }
  // Linked worktree: `.git` is a file whose first line is
  // `gitdir: <absolute path>`. Resolve to that and look for `config`
  // there. If the resolution fails we fall back to the file path's
  // neighbour, which is the only safe default for a regular clone.
  if (stat.isFile()) {
    let contents;
    try {
      contents = fs.readFileSync(gitEntry, "utf8");
    } catch (error) {
      throw new Error(
        `Cannot read cloned repo config pointer at ${gitEntry}: ${
          error && error.code ? error.code : "unknown error"
        }. Expected the canonical URL ${canonicalUrl}.`,
      );
    }
    const match = contents.match(/^\s*gitdir:\s*(.+)\s*$/mu);
    if (match) {
      return path.join(match[1].trim(), "config");
    }
  }
  return path.join(gitEntry, "config");
};

/**
 * Defensively rewrite `<cloneDir>/.git/config` so that the
 * `[remote "origin"]` `url =` line is the canonical
 * `https://github.com/<owner>/<repo>.git` form. This is a belt-and-suspenders
 * repair for clones that may have been checked out by an older release of
 * this script that URL-embedded the `GH_TOKEN` into the clone URL (which
 * Git would then persist to `.git/config`). The helper is safe to call on a
 * clone whose origin URL is already canonical (no-op), and on a clone that
 * has no `[remote "origin"]` section or no `url =` line (it adds them).
 *
 * Errors raised by this helper mention only the canonical URL — never the
 * original (potentially credentialed) URL — so a failed repair cannot leak
 * the credential through an exception message.
 *
 * @param {string} cloneDir The absolute path to the cloned repository root.
 * @param {string} canonicalUrl The canonical URL to enforce, e.g.
 *   `https://github.com/<owner>/<repo>.git`. Must not contain userinfo.
 * @returns {{ url: string, changed: boolean }} The final value of
 *   `remote.origin.url` and whether the file was modified.
 */
export const normalizeOriginUrl = (cloneDir, canonicalUrl) => {
  if (typeof cloneDir !== "string" || !cloneDir) {
    throw new Error("normalizeOriginUrl requires a non-empty cloneDir path.");
  }
  assertSafeCanonicalUrl(canonicalUrl);
  // The canonical URL is itself subject to the same rules: it must not
  // smuggle credentials in. This is a programmer-error guard, not a
  // runtime guard for the persisted value.
  assertSafeOriginUrlValue(canonicalUrl, canonicalUrl);

  const configPath = resolveClonedRepoConfigPath(cloneDir, canonicalUrl);

  let original;
  try {
    original = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read clone config at ${configPath}: ${
        error && error.code ? error.code : "unknown error"
      }. Expected the canonical URL ${canonicalUrl}.`,
    );
  }

  // The INI grammar we need to parse is intentionally narrow: a config
  // file is a sequence of lines, lines are either section headers
  // (`[name]` or `[name "subsection"]`) or `key = value` pairs, and
  // comments start with `#` or `;`. We deliberately do not pull in an
  // INI library; a small line-based scan is enough for the section we
  // own (`[remote "origin"]`).
  const lines = original.split(/\r?\n/u);
  let sectionStart = -1;
  let sectionEnd = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '[remote "origin"]') {
      sectionStart = i;
      // Section runs until the next `[` line or end of file.
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s*\[/u.test(lines[j])) {
          sectionEnd = j;
          break;
        }
      }
      if (sectionEnd === -1) {
        sectionEnd = lines.length;
      }
      break;
    }
  }

  let urlLineIndex = -1;
  if (sectionStart !== -1) {
    for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
      const match = lines[i].match(/^\s*url\s*=\s*(.*?)\s*$/u);
      if (match) {
        urlLineIndex = i;
        break;
      }
    }
  }

  if (urlLineIndex !== -1) {
    const currentValue = lines[urlLineIndex].match(/^\s*url\s*=\s*(.*?)\s*$/u)[1];
    if (currentValue === canonicalUrl) {
      return { url: canonicalUrl, changed: false };
    }
    // Determine the leading whitespace of the `url =` line so we
    // preserve indentation style (`\t` for git's own writer, but we
    // tolerate spaces).
    const indent = lines[urlLineIndex].match(/^\s*/u)[0];
    lines[urlLineIndex] = `${indent}url = ${canonicalUrl}`;
  } else if (sectionStart !== -1) {
    // Section exists, no `url =` line: insert one immediately after the
    // section header.
    lines.splice(sectionStart + 1, 0, `\turl = ${canonicalUrl}`);
  } else {
    // No `[remote "origin"]` section: append a new section.
    // Ensure the file ends with a newline so the appended section is
    // well-formed.
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push('[remote "origin"]');
    lines.push(`\turl = ${canonicalUrl}`);
  }

  const updated = `${lines.join("\n")}`;
  try {
    fs.writeFileSync(configPath, updated);
  } catch (error) {
    throw new Error(
      `Cannot write clone config at ${configPath}: ${
        error && error.code ? error.code : "unknown error"
      }. Expected the canonical URL ${canonicalUrl}.`,
    );
  }
  return { url: canonicalUrl, changed: true };
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
  // `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0`
  // (see `createIsolatedGitAuthContext`). `displayUrl` is what we use
  // in user-facing error messages so a failed `ls-remote` never
  // echoes the credentialed URL.
  const canonicalUrl = `https://github.com/${courseSource.repo}.git`;
  const displayUrl = canonicalUrl;
  const authContext = ghToken ? createIsolatedGitAuthContext(ghToken) : null;
  const authEnv = authContext?.authEnv;
  const isolatedCwd = authContext?.cwd;
  try {
    const headSha = resolveRemoteHeadSha({
      repoUrl: canonicalUrl,
      displayUrl,
      ref: courseSource.ref,
      authEnv,
      cwd: isolatedCwd,
    });
    activeSourceId = `repo:${courseSource.repo}#${courseSource.ref}@${headSha}`;

    if (previousSourceId !== activeSourceId || !hasGitClone(cloneDir)) {
      rmIfExists(cloneDir);
      run(
        gitCommand,
        ["clone", "--depth", "1", "--branch", courseSource.ref, canonicalUrl, cloneDir],
        { authEnv, cwd: isolatedCwd },
      );
      // Defensively rewrite `remote.origin.url` so a future `git
      // remote -v` (or a re-invocation of this script on a stale
      // clone) cannot surface a credentialed origin. The error
      // path does not leak the original URL.
      normalizeOriginUrl(cloneDir, canonicalUrl);
    } else {
      // Existing clone is being reused: repair its origin URL
      // BEFORE we read any file from it (so the rest of the mirror
      // pipeline cannot observe a credentialed value in
      // `.git/config`).
      normalizeOriginUrl(cloneDir, canonicalUrl);
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

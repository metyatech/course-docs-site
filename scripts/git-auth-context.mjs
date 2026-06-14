// Build a short-lived, fully isolated auth context for the spawned git
// process used by `scripts/sync-course-content.mjs`. The context delivers
// the `GH_TOKEN` to the spawned git exclusively through the
// `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` triple
// (plus `GIT_TERMINAL_PROMPT=0`) and explicitly overrides every Git
// configuration entry point that could carry stale credentials from
// the parent shell or from `actions/checkout`:
//
//   - `GIT_CONFIG_GLOBAL` is set to an EMPTY file in `os.tmpdir()` so the
//     spawned git has a global gitconfig to read but it has zero
//     `http.<url>.extraheader` (or any other) entries. Without this
//     override, unsetting `GIT_CONFIG_GLOBAL` would let Git fall back
//     to `~/.gitconfig` and pick up a stale `extraheader` left there by
//     a prior `actions/checkout`.
//   - `GIT_CONFIG_NOSYSTEM=1` prevents Git from reading the system
//     gitconfig.
//   - `GIT_CONFIG_SYSTEM` is pointed at the OS-specific null device
//     (`NUL` on Windows, `/dev/null` elsewhere) so any code path that
//     ignores `GIT_CONFIG_NOSYSTEM` still reads an empty file.
//
// The empty file is removed in `disposeIsolatedGitAuthContext`. The
// `cwd` returned alongside the env is a fresh empty tmpdir (no `.git/`,
// so no `includeIf.gitdir:` rule from the workspace's `.git/config` can
// match) and is removed in the same disposer. The token is never
// written to a file, never appears in argv, and never reaches a
// user-visible log line.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Returns `"NUL"` on Windows and `"/dev/null"` everywhere else. The
// null-device path is the one filesystem entry that is always writable
// and always reads as an empty file, so it is the safe choice for
// "tell Git to read a gitconfig that is guaranteed empty".
export const getNullDevicePath = () => (os.platform() === "win32" ? "NUL" : "/dev/null");

// Variables that must be scrubbed from the inherited parent env before
// we install the isolated `GIT_CONFIG_*` triple. Anything on this list
// is either a Git override variable that could carry auth/credential
// material from the parent shell or a previous `actions/checkout` step,
// or a multi-value `GIT_CONFIG_*` form that would silently combine with
// our injected `KEY_0` / `VALUE_0` and either prepend a stale
// `extraheader` (the bug we are defending against) or override it
// (which would silently drop our Authorization header).
export const SCRUBBED_GIT_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
];

// Pattern matching all `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>`
// entries (the count is variable; we scrub the whole numeric range so
// our injected `KEY_0` / `VALUE_0` cannot be combined with a stale
// index from the parent env).
export const SCRUBBED_GIT_ENV_KEY_PATTERN = /^GIT_CONFIG_(KEY|VALUE)_\d+$/u;

// Build a short-lived, isolated auth context for the spawned git
// process. The returned `cwd` is a fresh, empty tmpdir that the spawned
// process should chdir into; the returned `authEnv` is meant to be
// merged on top of a scrubbed `process.env` (see `buildScrubbedIsolatedEnv`).
// No persistent state is mutated: the cwd tmpdir and the global-config
// tmpfile both live under `os.tmpdir()` and are removed in
// `disposeIsolatedGitAuthContext`. We never write to the workspace's
// `.git/config`, the user's `~/.gitconfig`, the system gitconfig, or
// any file outside `os.tmpdir()`.
//
// The returned `authEnv` shape is:
//
//   {
//     GIT_CONFIG_COUNT: "1",
//     GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
//     GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic <base64>",
//     GIT_CONFIG_GLOBAL: "<empty tmpfile under os.tmpdir()>",
//     GIT_CONFIG_NOSYSTEM: "1",
//     GIT_CONFIG_SYSTEM: "<NUL or /dev/null>",
//     GIT_TERMINAL_PROMPT: "0",
//   }
//
// @param {string} token The PAT to deliver to the spawned git process.
// @returns {{ cwd: string, authEnv: Record<string, string>, globalConfigPath: string, nullDevice: string }}
export const createIsolatedGitAuthContext = (token) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "course-docs-git-cwd-"));
  // The global-config tmpfile MUST be empty: any `extraheader` in it
  // would be merged with our injected one by Git. We use the same
  // mkdtemp prefix family as the cwd tmpdir so the two artifacts are
  // visually adjacent in `os.tmpdir()` listings.
  const globalConfigPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "course-docs-git-global-")),
    "empty.gitconfig",
  );
  fs.writeFileSync(globalConfigPath, "", { encoding: "utf8", mode: 0o600 });
  const headerValue = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const nullDevice = getNullDevicePath();
  const authEnv = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: headerValue,
    // Override the global gitconfig with an empty file under
    // `os.tmpdir()`. This prevents Git from falling back to
    // `~/.gitconfig` (which may carry a stale `extraheader` left by
    // a prior `actions/checkout`).
    GIT_CONFIG_GLOBAL: globalConfigPath,
    // Disable the system gitconfig outright. This is the documented
    // override for "do not read /etc/gitconfig".
    GIT_CONFIG_NOSYSTEM: "1",
    // Point the system gitconfig at the OS null device. Any code path
    // that ignores `GIT_CONFIG_NOSYSTEM` (e.g. a misbehaving wrapper)
    // still reads an empty file.
    GIT_CONFIG_SYSTEM: nullDevice,
    // Disable interactive credential prompts so any unexpected auth
    // challenge fails fast rather than hanging CI.
    GIT_TERMINAL_PROMPT: "0",
  };
  return { cwd, authEnv, globalConfigPath, nullDevice };
};

// Remove the tmpdir and the empty global-config file. Best-effort:
// cleanup failures MUST NOT mask the original error. The
// `globalConfigPath` lives in its own mkdtemp dir (not inside `cwd`)
// so we always remove both, even if one of them is missing on disk.
export const disposeIsolatedGitAuthContext = (context) => {
  if (!context) return;
  const { cwd, globalConfigPath } = context;
  if (globalConfigPath) {
    // Remove the empty gitconfig file first, then the parent mkdtemp
    // dir. We use `unlinkSync` + `rmdirSync` rather than
    // `rmSync({ recursive: true })` because the latter is unreliable
    // for empty files on some Windows filesystems (the rmSync call
    // returns without raising an error and without removing the file).
    try {
      fs.unlinkSync(globalConfigPath);
    } catch {
      // best-effort cleanup
    }
    try {
      fs.rmdirSync(path.dirname(globalConfigPath));
    } catch {
      // best-effort cleanup
    }
  }
  if (cwd) {
    try {
      fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // best-effort cleanup; never let cleanup mask the original error
    }
  }
};

// Clone `process.env`, scrub every Git override variable (the 8 named
// keys in `SCRUBBED_GIT_ENV_KEYS` plus every `GIT_CONFIG_KEY_<n>` /
// `GIT_CONFIG_VALUE_<n>` matched by `SCRUBBED_GIT_ENV_KEY_PATTERN`),
// then merge `authEnv` on top so the spawned git process has exactly
// the Authorization header we want and nothing else.
//
// Accepts a `baseEnv` override for testability; defaults to
// `process.env` for production use.
//
// @param {Record<string, string> | null | undefined} authEnv
// @param {Record<string, string | undefined>} [baseEnv]
// @returns {Record<string, string | undefined>}
export const buildScrubbedIsolatedEnv = (authEnv, baseEnv = process.env) => {
  const env = { ...baseEnv };
  for (const key of SCRUBBED_GIT_ENV_KEYS) {
    delete env[key];
  }
  // Multi-value `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` entries
  // are matched by pattern (the count is variable). We scrub the whole
  // numeric range so our injected `KEY_0` / `VALUE_0` cannot be combined
  // with a stale index from the parent env.
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

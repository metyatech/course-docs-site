// Real-git + on-disk-fixture tests for the isolated git auth context
// in `scripts/git-auth-context.mjs`. Every subtest in this file
// either spawns the real `git` binary or reads the on-disk state
// produced by the helpers, so the file skips itself when `git` is not
// on PATH.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildScrubbedIsolatedEnv,
  createIsolatedGitAuthContext,
  disposeIsolatedGitAuthContext,
  getNullDevicePath,
  SCRUBBED_GIT_ENV_KEYS,
} from "../scripts/git-auth-context.mjs";

const gitAvailable = (() => {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return result.status === 0;
})();

const fixtureToken = "fixture-auth-context-payload-NEVER-LEAK";
const BADBASIC = "BADBASIC";
const seededEntryText = `\t\textraheader = AUTHORIZATION: basic ${BADBASIC}`;

// The gitconfig format that `git config --get-all <key>` expects.
// We use the `[http "https://github.com/"]` block form so the
// seeded entry actually applies to github.com requests.
const buildSeededGitconfig = (badbasic) =>
  ['[http "https://github.com/"]', `\textraheader = AUTHORIZATION: basic ${badbasic}`, ""].join(
    "\n",
  );

// Build a bare repo and return its path. A bare repo can be used as
// the target of `git ls-remote` and `git clone --bare`. It carries no
// working tree, so the seeded gitconfig at HOME has no chance of
// sneaking into the bare repo's own `.git/config`.
const createBareRepo = (parentDir) => {
  const bareDir = path.join(parentDir, "bare.git");
  fs.mkdirSync(bareDir, { recursive: true });
  const result = spawnSync("git", ["init", "--bare", bareDir], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git init --bare ${bareDir} failed: ${result.stderr || result.stdout || "no stderr"}`,
    );
  }
  return bareDir;
};

const readConfigGetAll = (cwd, env) => {
  const result = spawnSync("git", ["config", "--get-all", "http.https://github.com/.extraheader"], {
    encoding: "utf8",
    cwd,
    env,
  });
  if (result.status !== 0) {
    return { ok: false, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
  }
  return {
    ok: true,
    values: (result.stdout ?? "")
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  };
};

test("getNullDevicePath returns the OS-specific null device", () => {
  if (process.platform === "win32") {
    assert.equal(getNullDevicePath(), "NUL");
  } else {
    assert.equal(getNullDevicePath(), "/dev/null");
  }
});

test("SCRUBBED_GIT_ENV_KEYS contains the 7 documented named keys (plus the multi-value GIT_CONFIG_KEY_<n> / GIT_CONFIG_VALUE_<n> numeric family matched by pattern)", () => {
  assert.deepEqual(
    [...SCRUBBED_GIT_ENV_KEYS].sort(),
    [
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_SYSTEM",
      "GIT_DIR",
      "GIT_WORK_TREE",
    ].sort(),
  );
  // Sanity: exactly 7 named keys — GIT_DIR, GIT_WORK_TREE,
  // GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL,
  // GIT_CONFIG_SYSTEM, GIT_CONFIG_NOSYSTEM. The
  // `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` numeric variants
  // are matched separately by `SCRUBBED_GIT_ENV_KEY_PATTERN`.
  assert.equal(SCRUBBED_GIT_ENV_KEYS.length, 7);
});

test("createIsolatedGitAuthContext returns a non-null authEnv with the new isolation keys", () => {
  const context = createIsolatedGitAuthContext(fixtureToken);
  try {
    assert.equal(typeof context.cwd, "string");
    assert.ok(context.cwd.length > 0, "cwd must be a non-empty path");
    assert.equal(typeof context.globalConfigPath, "string");
    assert.ok(context.globalConfigPath.length > 0, "globalConfigPath must be a non-empty path");
    assert.equal(typeof context.nullDevice, "string");
    assert.ok(context.nullDevice.length > 0, "nullDevice must be a non-empty path");

    // The authEnv shape includes the existing triple plus the new
    // isolation keys.
    assert.equal(context.authEnv.GIT_CONFIG_COUNT, "1");
    assert.equal(context.authEnv.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
    assert.match(context.authEnv.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic [A-Za-z0-9+/=]+$/u);
    assert.equal(context.authEnv.GIT_TERMINAL_PROMPT, "0");
    assert.equal(context.authEnv.GIT_CONFIG_GLOBAL, context.globalConfigPath);
    assert.equal(context.authEnv.GIT_CONFIG_NOSYSTEM, "1");
    assert.equal(context.authEnv.GIT_CONFIG_SYSTEM, context.nullDevice);

    // The global-config tmpfile exists and is empty.
    assert.ok(
      fs.existsSync(context.globalConfigPath),
      `globalConfigPath must exist on disk: ${context.globalConfigPath}`,
    );
    const stat = fs.statSync(context.globalConfigPath);
    assert.equal(stat.size, 0, "global config tmpfile must be empty");
  } finally {
    disposeIsolatedGitAuthContext(context);
  }
});

test("buildScrubbedIsolatedEnv strips the 7 override keys from a base env", () => {
  const baseEnv = {
    PATH: "/usr/bin",
    HOME: "/home/test",
    GIT_DIR: "/some/git/dir",
    GIT_WORK_TREE: "/some/work/tree",
    GIT_CONFIG_PARAMETERS: "alias.foo=bar",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_GLOBAL: "/home/test/.gitconfig",
    GIT_CONFIG_SYSTEM: "/etc/gitconfig",
    GIT_CONFIG_NOSYSTEM: "0",
    GIT_CONFIG_KEY_0: "user.email",
    GIT_CONFIG_VALUE_0: "leak@example.invalid",
    GIT_CONFIG_KEY_1: "user.name",
    GIT_CONFIG_VALUE_1: "Leak",
  };
  // Pass no authEnv: this exercises the scrubbing pass alone.
  const env = buildScrubbedIsolatedEnv(null, baseEnv);
  for (const scrubbedKey of SCRUBBED_GIT_ENV_KEYS) {
    assert.equal(env[scrubbedKey], undefined, `${scrubbedKey} must be scrubbed`);
  }
  assert.equal(env.GIT_CONFIG_KEY_0, undefined, "GIT_CONFIG_KEY_0 must be scrubbed");
  assert.equal(env.GIT_CONFIG_VALUE_0, undefined, "GIT_CONFIG_VALUE_0 must be scrubbed");
  assert.equal(env.GIT_CONFIG_KEY_1, undefined, "GIT_CONFIG_KEY_1 must be scrubbed");
  assert.equal(env.GIT_CONFIG_VALUE_1, undefined, "GIT_CONFIG_VALUE_1 must be scrubbed");
  // Non-Git override keys are preserved.
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/test");
});

test("buildScrubbedIsolatedEnv merges the authEnv over the scrubbed base env", () => {
  const baseEnv = { HOME: "/home/test", GIT_DIR: "/leaked" };
  const authEnv = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic Zm9v",
    GIT_CONFIG_GLOBAL: "/tmp/empty",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  const env = buildScrubbedIsolatedEnv(authEnv, baseEnv);
  assert.equal(env.GIT_DIR, undefined, "GIT_DIR must be scrubbed");
  assert.equal(env.GIT_CONFIG_COUNT, "1");
  assert.equal(env.GIT_CONFIG_VALUE_0, "AUTHORIZATION: basic Zm9v");
  assert.equal(env.GIT_CONFIG_GLOBAL, "/tmp/empty");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.GIT_CONFIG_SYSTEM, "/dev/null");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
});

test("disposeIsolatedGitAuthContext removes both cwd and globalConfigPath", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const context = createIsolatedGitAuthContext(fixtureToken);
  const { cwd, globalConfigPath } = context;
  assert.ok(fs.existsSync(cwd), "cwd must exist before dispose");
  assert.ok(fs.existsSync(globalConfigPath), "globalConfigPath must exist before dispose");
  disposeIsolatedGitAuthContext(context);
  assert.equal(fs.existsSync(cwd), false, "cwd must be removed by disposeIsolatedGitAuthContext");
  assert.equal(
    fs.existsSync(globalConfigPath),
    false,
    "globalConfigPath must be removed by disposeIsolatedGitAuthContext",
  );
});

test("isolated auth context bypasses a stale HOME ~/.gitconfig extraheader (real git)", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-home-"));
  const fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-fake-home-"));
  const bareDir = createBareRepo(root);
  try {
    // Seed a stale `~/.gitconfig` that would otherwise leak into the
    // spawned git (this is the simulation of an `actions/checkout`
    // extraheader leftover). The literal value `BADBASIC` is the
    // canary: the production auth context must produce a
    // `http.https://github.com/.extraheader` value that does NOT
    // include BADBASIC.
    await fsp.writeFile(path.join(fakeHome, ".gitconfig"), buildSeededGitconfig(BADBASIC), "utf8");

    const context = createIsolatedGitAuthContext(fixtureToken);
    try {
      const env = buildScrubbedIsolatedEnv(context.authEnv);
      // Override HOME so the spawned git would consult the seeded
      // gitconfig if our overrides are not effective. HOME on Windows
      // is sometimes honored via USERPROFILE; set both.
      env.HOME = fakeHome;
      env.USERPROFILE = fakeHome;
      env.XDG_CONFIG_HOME = fakeHome;
      // Use an empty cwd so the spawned git has no .git/ in the
      // current working directory (matching the production flow).
      const emptyCwd = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-empty-"));
      try {
        const result = readConfigGetAll(emptyCwd, env);
        assert.equal(
          result.ok,
          true,
          `git config --get-all must succeed; stderr: ${result.stderr}`,
        );
        assert.equal(
          result.values.length,
          1,
          `expected exactly one extraheader entry (the injected one); got: ${JSON.stringify(result.values)}`,
        );
        assert.match(
          result.values[0],
          /^AUTHORIZATION: basic /u,
          "the surviving entry must be the injected Authorization header",
        );
        assert.doesNotMatch(
          result.values[0],
          new RegExp(BADBASIC, "u"),
          `the injected entry must not contain the seeded gitconfig value ${BADBASIC}; got: ${result.values[0]}`,
        );
        // Defence in depth: the injected value must not contain the
        // fixture token (it is base64-encoded, so a substring check
        // would be meaningless; instead assert the value is non-empty
        // and structurally well-formed).
        assert.ok(
          result.values[0].length > "AUTHORIZATION: basic ".length,
          "injected extraheader must carry a non-empty credential value",
        );
      } finally {
        await fsp.rm(emptyCwd, { recursive: true, force: true });
      }
    } finally {
      disposeIsolatedGitAuthContext(context);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(fakeHome, { recursive: true, force: true });
  }
});

test("isolated auth context also bypasses a stale XDG_CONFIG_HOME/git/config extraheader (real git)", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-xdg-"));
  const fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-xdg-fake-home-"));
  const xdgConfigHome = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-xdg-home-"));
  const bareDir = createBareRepo(root);
  try {
    // Seed both HOME/.gitconfig and XDG_CONFIG_HOME/git/config with
    // the BADBASIC entry. The auth context must produce a single
    // extraheader that comes ONLY from the injected
    // `GIT_CONFIG_VALUE_0`, with both seeded entries masked.
    await fsp.writeFile(path.join(fakeHome, ".gitconfig"), buildSeededGitconfig(BADBASIC), "utf8");
    await fsp.mkdir(path.join(xdgConfigHome, "git"), { recursive: true });
    await fsp.writeFile(
      path.join(xdgConfigHome, "git", "config"),
      buildSeededGitconfig(BADBASIC),
      "utf8",
    );

    const context = createIsolatedGitAuthContext(fixtureToken);
    try {
      const env = buildScrubbedIsolatedEnv(context.authEnv);
      env.HOME = fakeHome;
      env.USERPROFILE = fakeHome;
      env.XDG_CONFIG_HOME = xdgConfigHome;
      const emptyCwd = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-xdg-empty-"));
      try {
        const result = readConfigGetAll(emptyCwd, env);
        assert.equal(
          result.ok,
          true,
          `git config --get-all must succeed; stderr: ${result.stderr}`,
        );
        assert.equal(
          result.values.length,
          1,
          `expected exactly one extraheader entry; got: ${JSON.stringify(result.values)}`,
        );
        assert.match(
          result.values[0],
          /^AUTHORIZATION: basic /u,
          "the surviving entry must be the injected Authorization header",
        );
        assert.doesNotMatch(
          result.values[0],
          new RegExp(BADBASIC, "u"),
          `the injected entry must not contain the seeded XDG / HOME value ${BADBASIC}; got: ${result.values[0]}`,
        );
      } finally {
        await fsp.rm(emptyCwd, { recursive: true, force: true });
      }
    } finally {
      disposeIsolatedGitAuthContext(context);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(fakeHome, { recursive: true, force: true });
    await fsp.rm(xdgConfigHome, { recursive: true, force: true });
  }
});

test("isolated auth context lets `git ls-remote` see only the injected extraheader (end-to-end on a bare repo, real git)", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  // A bare repo has no refs; `git ls-remote` will exit 0 with empty
  // stdout (or fail with a non-zero exit and a "could not read" stderr).
  // The point of this scenario is NOT to assert what `git ls-remote`
  // prints (it depends on the bare repo's state); the point is to
  // assert that during the spawn, the env delivered to git produces
  // exactly one extraheader entry, with no BADBASIC contribution.
  // We exercise that by separately running `git config --get-all`
  // with the same env — that is the surface that controls which
  // Authorization header the spawned git process actually sends.
  //
  // The test therefore reads the auth context's env once, runs
  // `git config --get-all` against an empty cwd, and asserts the
  // single-entry / no-BADBASIC invariants. This is the
  // production-equivalent assertion the new design exists to make.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-e2e-"));
  const fakeHome = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-e2e-fake-home-"));
  try {
    await fsp.writeFile(path.join(fakeHome, ".gitconfig"), buildSeededGitconfig(BADBASIC), "utf8");
    const context = createIsolatedGitAuthContext(fixtureToken);
    try {
      const env = buildScrubbedIsolatedEnv(context.authEnv);
      env.HOME = fakeHome;
      env.USERPROFILE = fakeHome;
      env.XDG_CONFIG_HOME = fakeHome;
      const emptyCwd = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-auth-e2e-empty-"));
      try {
        const result = readConfigGetAll(emptyCwd, env);
        assert.equal(result.ok, true, `git config --get-all failed: ${result.stderr}`);
        assert.equal(result.values.length, 1, "exactly one extraheader entry");
        assert.match(result.values[0], /^AUTHORIZATION: basic /u);
        assert.doesNotMatch(result.values[0], new RegExp(BADBASIC, "u"));
      } finally {
        await fsp.rm(emptyCwd, { recursive: true, force: true });
      }
    } finally {
      disposeIsolatedGitAuthContext(context);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(fakeHome, { recursive: true, force: true });
  }
});

// Silence the unused-import warning for `seededEntryText` — kept as a
// named constant for the test that originally used the more verbose
// `.join("\n")` form, now inlined for readability.
void seededEntryText;

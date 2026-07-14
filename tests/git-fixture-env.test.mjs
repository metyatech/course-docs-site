import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createIsolatedGitFixtureEnv } from "./git-fixture-env.mjs";

test("isolates hook Git variables without mutating its input", () => {
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, NORMAL: "kept", GIT_DIR: "x", GIT_WORK_TREE: "x", GIT_INDEX_FILE: "x", GIT_OBJECT_DIRECTORY: "x", GIT_ALTERNATE_OBJECT_DIRECTORIES: "x", GIT_COMMON_DIR: "x", GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "x", GIT_CONFIG_VALUE_0: "x", GIT_CONFIG_KEY_9: "x", GIT_CONFIG_VALUE_9: "x" };
  const isolated = createIsolatedGitFixtureEnv(base);
  for (const key of Object.keys(base).filter((key) => key.startsWith("GIT_"))) assert.equal(isolated[key], undefined);
  assert.equal(isolated.PATH, base.PATH); assert.equal(isolated.HOME, base.HOME); assert.equal(isolated.NORMAL, "kept"); assert.equal(base.GIT_DIR, "x");
});

test("isolated fixture env initializes a real temporary repository", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-fixture-env-"));
  try {
    const result = spawnSync("git", ["init", dir], { encoding: "utf8", env: createIsolatedGitFixtureEnv({ ...process.env, GIT_DIR: "outer", GIT_WORK_TREE: "outer" }) });
    assert.equal(result.status, 0, result.stderr); assert.equal(fs.existsSync(path.join(dir, ".git")), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

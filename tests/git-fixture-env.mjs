import { spawnSync } from "node:child_process";

const fallbackKeys = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX",
  "GIT_INTERNAL_SUPER_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR", "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM",
];

export const createIsolatedGitFixtureEnv = (baseEnv = process.env) => {
  const result = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
  const keys = new Set(fallbackKeys);
  if (result.status === 0) {
    for (const key of (result.stdout ?? "").split(/\r?\n/u)) if (key) keys.add(key);
  }
  const isolated = { ...baseEnv };
  for (const key of Object.keys(isolated)) {
    if (keys.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(key)) delete isolated[key];
  }
  return isolated;
};

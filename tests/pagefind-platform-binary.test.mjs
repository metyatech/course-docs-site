import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

const normalizePlatform = (platform) => {
  if (platform === "win32") {
    return "windows";
  }

  return platform;
};

test("pagefind current platform binary is declared explicitly and installed", () => {
  const platform = normalizePlatform(process.platform);
  const packageName = `@pagefind/${platform}-${process.arch}`;

  assert.equal(
    pkg.optionalDependencies?.[packageName],
    "1.5.0",
    `Expected package.json optionalDependencies to pin ${packageName}.`,
  );
  assert.doesNotThrow(
    () => require.resolve(`${packageName}/package.json`),
    `Expected ${packageName} to be installed after npm install/npm ci.`,
  );
});

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");
const patchesDir = path.join(projectRoot, "patches");

const parsePatchFileName = (fileName) => {
  const stem = fileName.replace(/\.patch$/, "");
  const parts = stem.split("+");
  const version = parts.pop();
  const packageName = parts[0].startsWith("@")
    ? `${parts[0]}/${parts.slice(1).join("+")}`
    : parts.join("+");

  return { packageName, version };
};

test("security scripts gate high audits and hard-fail broken patches", async () => {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));

  assert.equal(pkg.dependencies.next, "^15.5.18");
  assert.equal(pkg.devDependencies["eslint-config-next"], "^15.5.18");
  assert.equal(pkg.overrides.mermaid, "11.15.0");
  assert.equal(pkg.overrides.dompurify, "3.4.3");
  assert.equal(pkg.overrides["@xmldom/xmldom"], "0.9.10");
  assert.equal(
    pkg.scripts.postinstall,
    "patch-package --error-on-fail && node scripts/check-platform-cache.mjs",
  );
  assert.equal(pkg.scripts["audit:ci"], "npm audit --audit-level=high");
  assert.equal(
    pkg.scripts["verify:ci"],
    "npm run audit:ci && npm run build && npm run verify:course:ci",
  );
});

test("patch-package files match installed package versions", async () => {
  const lockfile = JSON.parse(await readFile(packageLockPath, "utf8"));
  const patchFiles = (await readdir(patchesDir)).filter((fileName) => fileName.endsWith(".patch"));

  assert.ok(patchFiles.length > 0, "Expected repository-owned patch-package patches.");

  for (const patchFile of patchFiles) {
    const { packageName, version } = parsePatchFileName(patchFile);
    const lockPackage = lockfile.packages[`node_modules/${packageName}`];

    assert.ok(lockPackage, `Expected package-lock entry for patched package ${packageName}.`);
    assert.equal(
      version,
      lockPackage.version,
      `${patchFile} must be regenerated when ${packageName} changes version.`,
    );
  }
});

test("Nextra Git timestamp warning patch only suppresses synced content warnings", async () => {
  const patch = await readFile(path.join(patchesDir, "nextra+4.6.1.patch"), "utf8");

  assert.match(patch, /Failed to get the last modified timestamp from Git for the file/);
  assert.ok(
    patch.includes('relativePath.split(/[\\\\/]/).includes("content")'),
    "The Nextra patch must suppress timestamp warnings when Nextra reports synced content through relative parent paths.",
  );
  assert.ok(
    patch.includes("if (!isSyncedContentPath)"),
    "The Nextra patch must keep warnings for non-content timestamp lookup failures.",
  );
});

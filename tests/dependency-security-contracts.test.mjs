import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");
const patchesDir = path.join(projectRoot, "patches");

const compareVersions = (left, right) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
};

const parseVersion = (value) => {
  const match = /^(?:\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  assert.ok(match, `Expected a simple Playwright version, received ${value}.`);
  return match.slice(1).map(Number);
};

const parsePatchFileName = (fileName) => {
  const stem = fileName.replace(/\.patch$/, "");
  const parts = stem.split("+");
  const version = parts.pop();
  const packageName = parts[0].startsWith("@")
    ? `${parts[0]}/${parts.slice(1).join("+")}`
    : parts.join("+");

  return { packageName, version };
};

test("dependency versions and patch installation stay pinned", async () => {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));

  assert.equal(pkg.dependencies.next, "^15.5.25");
  assert.equal(pkg.devDependencies["eslint-config-next"], "^15.5.25");
  assert.equal(pkg.dependencies.sharp, "^0.35.4");
  assert.equal(pkg.overrides.mermaid, "11.17.2");
  assert.equal(pkg.overrides.dompurify, "3.4.15");
  assert.equal(pkg.overrides["@xmldom/xmldom"], "0.9.12");
  assert.equal(pkg.overrides["brace-expansion"], "2.1.4");
  assert.equal(pkg.overrides.postcss, "8.5.28");
  assert.equal(pkg.overrides["speech-rule-engine"], "5.0.0-rc.4");
  assert.equal(pkg.scripts.postinstall, "patch-package --error-on-fail && npm run platform:build");
});

test("npm version and install-script approvals are strict and version-pinned", async () => {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const npmrc = await readFile(path.join(projectRoot, ".npmrc"), "utf8");

  assert.equal(pkg.engines.npm, "11.19.1");
  assert.deepEqual(pkg.devEngines.packageManager, {
    name: "npm",
    version: "^11.19.0",
    onFail: "error",
  });
  assert.deepEqual(pkg.allowScripts, {
    "esbuild@0.28.1": true,
    "unrs-resolver@1.11.1": true,
  });
  assert.match(npmrc, /^strict-allow-scripts=true$/m);
});

test("Playwright versions support Chromium installation on Ubuntu 26.04", async () => {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const lockfile = JSON.parse(await readFile(packageLockPath, "utf8"));
  const minimumVersion = [1, 60, 0];
  const manifestVersion = parseVersion(pkg.devDependencies["@playwright/test"]);

  assert.ok(
    compareVersions(manifestVersion, minimumVersion) >= 0,
    "Playwright 1.60.0 or newer is required for Ubuntu 26.04 browser installation.",
  );

  for (const packageName of ["@playwright/test", "playwright", "playwright-core"]) {
    const lockedVersion = lockfile.packages[`node_modules/${packageName}`]?.version;
    assert.ok(lockedVersion, `Expected a package-lock entry for ${packageName}.`);
    assert.ok(
      compareVersions(parseVersion(lockedVersion), minimumVersion) >= 0,
      `${packageName}@${lockedVersion} does not support Ubuntu 26.04 browser installation.`,
    );
  }
});

test("verify:ci script contains every required CI gate", async () => {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const verifyCi = pkg.scripts["verify:ci"];

  assert.equal(typeof verifyCi, "string", "verify:ci must be a string script definition");
  assert.doesNotMatch(verifyCi, /verify:sites|course-sites\.json/u);
  assert.match(verifyCi, /npm run build\b/, "verify:ci must run build");
  assert.match(
    verifyCi,
    /npm run verify:course:ci/,
    "verify:ci must run verify:course:ci (course E2E + build:verified)",
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

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateAuditReport, validateWaivers } from "../scripts/audit-dependencies.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");
const patchesDir = path.join(projectRoot, "patches");
const waiversPath = path.join(projectRoot, "security", "npm-audit-waivers.json");
const advisory = {
  source: 1240992,
  name: "braces",
  dependency: "braces",
  title: "braces vulnerability",
  url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  severity: "high",
  range: "<=3.0.3",
};

const readWaiverDefinition = async () => JSON.parse(await readFile(waiversPath, "utf8"));

const vulnerability = (name, via, effects = []) => ({
  name,
  severity: "high",
  isDirect: false,
  via,
  effects,
  range: "*",
  nodes: [`node_modules/${name}`],
  fixAvailable: false,
});

const auditReport = (vulnerabilities) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: Object.keys(vulnerabilities).length,
      critical: 0,
      total: Object.keys(vulnerabilities).length,
    },
  },
});

const propagatedBracesReport = () =>
  auditReport({
    braces: vulnerability("braces", [advisory], ["micromatch"]),
    micromatch: vulnerability("micromatch", ["braces"], ["fast-glob"]),
    "fast-glob": vulnerability("fast-glob", ["micromatch"], ["nextra"]),
    nextra: vulnerability("nextra", ["fast-glob"]),
  });

const evaluate = async (report, overrides = {}) =>
  evaluateAuditReport(report, {
    waivers: await readWaiverDefinition(),
    installedVersions: ["3.0.3"],
    latestVersion: "3.0.3",
    today: "2026-10-03",
    ...overrides,
  });

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
  assert.equal(pkg.overrides.dompurify, "3.4.16");
  assert.equal(pkg.overrides["@xmldom/xmldom"], "0.9.12");
  assert.equal(pkg.overrides["brace-expansion"], "2.1.7");
  const lock = JSON.parse(await readFile(packageLockPath, "utf8"));
  assert.equal(lock.packages["node_modules/brace-expansion"].version, "2.1.7");
  assert.equal(pkg.overrides.postcss, "8.5.28");
  assert.equal(pkg.overrides["speech-rule-engine"], "5.0.0-rc.4");
  assert.equal(pkg.scripts.postinstall, "patch-package --error-on-fail && npm run platform:build");
});

test("dependency audit waiver is structured, singular, and expires on the approved date", async () => {
  const waiver = validateWaivers(await readWaiverDefinition());
  assert.deepEqual(waiver, {
    advisorySource: 1240992,
    package: "braces",
    installedVersion: "3.0.3",
    ghsa: "GHSA-vfj7-8cjw-p6xm",
    cve: "CVE-2026-93687",
    expiresOn: "2026-11-03",
    reason: "no-official-fixed-release",
  });
});

test("dependency audit permits multiple propagated vulnerabilities with one braces root", async () => {
  const result = await evaluate(propagatedBracesReport());
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.rootSources, [1240992]);
  assert.equal(result.unwaivedAdvisories, 0);
});

test("dependency audit rejects another independent root advisory", async () => {
  const report = propagatedBracesReport();
  report.vulnerabilities.other = vulnerability("other", [
    {
      source: 999999,
      name: "other",
      dependency: "other",
      title: "independent issue",
      url: "https://example.invalid/advisory",
      severity: "high",
      range: "*",
    },
  ]);
  report.metadata.vulnerabilities.total += 1;
  report.metadata.vulnerabilities.high += 1;
  const result = await evaluate(report);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unexpected root advisory sources/u);
});

test("dependency audit rejects braces plus an unrelated advisory", async () => {
  const report = auditReport({
    braces: vulnerability("braces", [advisory]),
    other: vulnerability("other", [
      { ...advisory, source: 999999, name: "other", dependency: "other" },
    ]),
  });
  const result = await evaluate(report);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unexpected root advisory sources/u);
});

test("dependency audit rejects a mismatched advisory source and identity", async () => {
  const wrongSource = { ...advisory, source: 1240993 };
  const sourceResult = await evaluate(
    auditReport({ braces: vulnerability("braces", [wrongSource]) }),
  );
  assert.equal(sourceResult.ok, false);
  assert.match(sourceResult.reason, /Unexpected root advisory sources/u);

  const wrongIdentity = { ...advisory, url: "https://github.com/advisories/GHSA-wrong" };
  const identityResult = await evaluate(
    auditReport({ braces: vulnerability("braces", [wrongIdentity]) }),
  );
  assert.equal(identityResult.ok, false);
  assert.match(identityResult.reason, /metadata does not match/u);
});

test("dependency audit rejects an unexpected installed braces version", async () => {
  const result = await evaluate(propagatedBracesReport(), { installedVersions: ["3.0.4"] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /installed braces version/iu);
});

test("dependency audit rejects a newer registry braces release", async () => {
  const result = await evaluate(propagatedBracesReport(), { latestVersion: "3.0.4" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Registry latest/u);
});

test("dependency audit rejects an expired waiver", async () => {
  const result = await evaluate(propagatedBracesReport(), { today: "2026-11-04" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired on 2026-11-03/u);
});

test("dependency audit rejects unresolved graph nodes and malformed reports", async () => {
  const unresolved = await evaluate(
    auditReport({
      "fast-glob": vulnerability("fast-glob", ["micromatch"]),
    }),
  );
  assert.equal(unresolved.ok, false);
  assert.match(unresolved.reason, /cannot resolve micromatch/u);

  const malformed = await evaluate({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} });
  assert.equal(malformed.ok, false);
  assert.match(malformed.reason, /valid vulnerability metadata/u);
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
    "github:metyatech/exercise-module#3df39972c1785932717216afd6e95056455e15ff": true,
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
  assert.equal(pkg.scripts["audit:dependencies"], "node scripts/audit-dependencies.mjs");
  assert.match(pkg.scripts["verify:precommit"], /npm run audit:dependencies$/u);
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

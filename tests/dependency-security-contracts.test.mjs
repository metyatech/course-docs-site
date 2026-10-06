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
const katexAdvisory = {
  source: 1241206,
  name: "katex",
  dependency: "katex",
  title: "CVE-2026-103923",
  url: "https://github.com/advisories/GHSA-238p-pmpm-9mq7",
  severity: "low",
  range: ">=0.11.0 <0.18.2",
};
const approvedWaivers = [
  {
    advisorySource: 1240992,
    package: "braces",
    installedVersion: "3.0.3",
    ghsa: "GHSA-vfj7-8cjw-p6xm",
    cve: "CVE-2026-93687",
    expiresOn: "2026-11-03",
    reason: "no-official-fixed-release",
  },
  {
    advisorySource: 1241206,
    package: "katex",
    installedVersion: "0.16.47",
    ghsa: "GHSA-238p-pmpm-9mq7",
    cve: "CVE-2026-103923",
    expiresOn: "2026-10-20",
    reason: "upstream-range-incompatible-fixed-release",
  },
];

const readWaiverDefinition = async () => JSON.parse(await readFile(waiversPath, "utf8"));
const bracesWaiverDefinition = {
  schemaVersion: 1,
  waivers: [approvedWaivers[0]],
};

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

const combinedApprovedReport = () => {
  const report = propagatedBracesReport();
  report.vulnerabilities.katex = vulnerability("katex", [{ ...katexAdvisory }]);
  report.metadata.vulnerabilities.low = 1;
  report.metadata.vulnerabilities.total += 1;
  return report;
};

const evaluate = async (report, overrides = {}) =>
  evaluateAuditReport(report, {
    waivers: await readWaiverDefinition(),
    installedVersions: { braces: ["3.0.3"], katex: ["0.16.47"] },
    latestVersion: "3.0.3",
    today: "2026-10-03",
    ...overrides,
  });

const evaluateBracesOnly = async (report, overrides = {}) =>
  evaluate(report, { waivers: bracesWaiverDefinition, ...overrides });

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
  assert.equal(lock.packages["node_modules/source-map-js"].version, "1.2.2");
  assert.equal(pkg.overrides.postcss, "8.5.28");
  assert.equal(pkg.overrides["source-map-js"], "1.2.2");
  assert.equal(pkg.overrides["speech-rule-engine"], "5.0.0-rc.4");
  assert.equal(pkg.scripts.postinstall, "patch-package --error-on-fail && npm run platform:build");
});

test("dependency audit accepts multiple exact structured waivers", async () => {
  const definition = await readWaiverDefinition();
  assert.deepEqual(
    validateWaivers(definition),
    new Map(approvedWaivers.map((waiver) => [waiver.advisorySource, waiver])),
  );

  assert.throws(
    () =>
      validateWaivers({
        schemaVersion: 1,
        waivers: [approvedWaivers[0], approvedWaivers[1], approvedWaivers[1]],
      }),
    /duplicate|approved advisory/iu,
  );
  assert.throws(
    () =>
      validateWaivers({
        schemaVersion: 1,
        waivers: [{ ...approvedWaivers[1], advisorySource: 9999999 }],
      }),
    /unknown|approved advisory/iu,
  );
  assert.throws(
    () =>
      validateWaivers({
        schemaVersion: 1,
        waivers: [{ ...approvedWaivers[1], expiresOn: "2026-02-30" }],
      }),
    /YYYY-MM-DD/u,
  );
  assert.throws(
    () =>
      validateWaivers({
        schemaVersion: 1,
        waivers: [{ ...approvedWaivers[1], expiresOn: "2026-10-21" }],
      }),
    /expiresOn does not match/u,
  );
  assert.throws(
    () =>
      validateWaivers({ schemaVersion: 1, waivers: [{ ...approvedWaivers[1], note: "unknown" }] }),
    /unknown field/u,
  );
  assert.throws(
    () =>
      validateWaivers({
        schemaVersion: 1,
        waivers: [
          ...approvedWaivers,
          {
            advisorySource: 1241209,
            package: "source-map-js",
            installedVersion: "1.2.1",
            ghsa: "GHSA-68fv-2mgg-jv7q",
            cve: "CVE-2026-93749",
            expiresOn: "2026-10-20",
            reason: "upstream-range-incompatible-fixed-release",
          },
        ],
      }),
    /Unknown advisory/u,
  );
  assert.throws(() => validateWaivers({ schemaVersion: 1, waivers: "invalid" }), /waivers array/iu);
});

test("dependency audit passes a clean report only when there are no waivers", async () => {
  const result = await evaluate(auditReport({}), { waivers: { schemaVersion: 1, waivers: [] } });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.rootSources, []);
  assert.equal(result.unwaivedAdvisories, 0);
  assert.equal(result.waivedAdvisories, 0);
});

test("dependency audit rejects a stale waiver when the report is clean", async () => {
  const result = await evaluate(auditReport({}));
  assert.equal(result.ok, false);
  assert.match(result.reason, /waiver.*no longer needed/iu);
  assert.equal(result.unwaivedAdvisories, 0);
});

test("dependency audit rejects malformed waiver definitions even for a clean report", async () => {
  const result = await evaluate(auditReport({}), {
    waivers: { schemaVersion: 1, waivers: [{ unknownWaiver: true }] },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /waiver/i);
});

test("dependency audit passes the two expected root advisories", async () => {
  const result = await evaluate(combinedApprovedReport());
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.rootSources, [1240992, 1241206]);
  assert.equal(result.unwaivedAdvisories, 0);
  assert.equal(result.waivedAdvisories, 2);
});

test("dependency audit permits multiple propagated vulnerabilities with one braces root", async () => {
  const result = await evaluateBracesOnly(propagatedBracesReport());
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.rootSources, [1240992]);
  assert.equal(result.unwaivedAdvisories, 0);
});

test("dependency audit rejects the braces advisory when no waiver is configured", async () => {
  const result = await evaluateBracesOnly(propagatedBracesReport(), {
    waivers: { schemaVersion: 1, waivers: [] },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /No approved waiver/u);
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

test("dependency audit rejects an unexpected source-map-js root even with approved waivers", async () => {
  const report = combinedApprovedReport();
  report.vulnerabilities["source-map-js"] = vulnerability("source-map-js", [
    {
      source: 1241209,
      name: "source-map-js",
      dependency: "source-map-js",
      title: "CVE-2026-93749",
      url: "https://github.com/advisories/GHSA-68fv-2mgg-jv7q",
      severity: "high",
      range: ">=1.0.0 <1.2.2",
    },
  ]);
  report.metadata.vulnerabilities.high += 1;
  report.metadata.vulnerabilities.total += 1;
  const result = await evaluate(report);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unexpected root advisory sources.*1241209/u);
});

test("dependency audit rejects an expired KaTeX waiver", async () => {
  const result = await evaluate(combinedApprovedReport(), { today: "2026-10-21" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /expired on 2026-10-20/u);
});

test("dependency audit rejects a mismatched KaTeX waiver version", async () => {
  assert.throws(
    () =>
      validateWaivers({
        schemaVersion: 1,
        waivers: [{ ...approvedWaivers[1], installedVersion: "0.16.46" }],
      }),
    /installedVersion does not match/u,
  );
});

test("dependency audit rejects a mismatched KaTeX waiver reason", async () => {
  assert.throws(
    () =>
      validateWaivers({
        schemaVersion: 1,
        waivers: [{ ...approvedWaivers[1], reason: "no-official-fixed-release" }],
      }),
    /reason does not match/u,
  );
});

test("dependency audit rejects mismatched KaTeX report metadata", async () => {
  const report = combinedApprovedReport();
  report.vulnerabilities.katex.via[0].severity = "moderate";
  const result = await evaluate(report);
  assert.equal(result.ok, false);
  assert.match(result.reason, /katex identity/u);
});

test("dependency audit rejects a temporary expired-date mutation", async () => {
  const waivers = await readWaiverDefinition();
  waivers.waivers[1].expiresOn = "2026-10-05";
  const result = await evaluate(combinedApprovedReport(), {
    waivers,
    today: "2026-10-06",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /expiresOn does not match/u);
});

test("dependency audit rejects a wrong installed KaTeX version", async () => {
  const result = await evaluate(combinedApprovedReport(), {
    installedVersions: { braces: ["3.0.3"], katex: ["0.16.46"] },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /katex.*0\.16\.47/iu);
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
  const result = await evaluateBracesOnly(propagatedBracesReport(), {
    installedVersions: { braces: ["3.0.4"] },
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /installed braces version/iu);
});

test("dependency audit rejects a newer registry braces release", async () => {
  const result = await evaluateBracesOnly(propagatedBracesReport(), { latestVersion: "3.0.4" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Registry latest/u);
});

test("dependency audit rejects an expired waiver", async () => {
  const result = await evaluateBracesOnly(propagatedBracesReport(), { today: "2026-11-04" });
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

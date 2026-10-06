import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const waiverFilePath = path.join(projectRoot, "security", "npm-audit-waivers.json");
const EXPECTED_ADVISORIES = new Map([
  [
    1240992,
    {
      package: "braces",
      installedVersion: "3.0.3",
      ghsa: "GHSA-vfj7-8cjw-p6xm",
      cve: "CVE-2026-93687",
      severity: "high",
      url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
      range: "<=3.0.3",
      expiresOn: "2026-11-03",
      reason: "no-official-fixed-release",
    },
  ],
  [
    1241206,
    {
      package: "katex",
      installedVersion: "0.16.47",
      ghsa: "GHSA-238p-pmpm-9mq7",
      cve: "CVE-2026-103923",
      severity: "low",
      url: "https://github.com/advisories/GHSA-238p-pmpm-9mq7",
      range: ">=0.11.0 <0.18.2",
      expiresOn: "2026-10-20",
      reason: "upstream-range-incompatible-fixed-release",
    },
  ],
]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

export const validateWaivers = (definition) => {
  if (
    !isRecord(definition) ||
    definition.schemaVersion !== 1 ||
    Object.keys(definition).some((key) => !["schemaVersion", "waivers"].includes(key))
  ) {
    throw new Error("Waiver definition must use schemaVersion 1.");
  }
  if (!Array.isArray(definition.waivers)) {
    throw new Error("Waiver definition must contain a waivers array.");
  }
  const validated = new Map();
  const allowedKeys = new Set([
    "advisorySource",
    "package",
    "installedVersion",
    "ghsa",
    "cve",
    "expiresOn",
    "reason",
  ]);
  for (const waiver of definition.waivers) {
    if (!isRecord(waiver)) throw new Error("Waiver entry must be an object.");
    if (Object.keys(waiver).some((key) => !allowedKeys.has(key))) {
      throw new Error("Waiver entry contains an unknown field.");
    }
    const expected = EXPECTED_ADVISORIES.get(waiver.advisorySource);
    if (!expected) throw new Error(`Unknown advisory waiver source ${waiver.advisorySource}.`);
    if (validated.has(waiver.advisorySource)) {
      throw new Error(`Duplicate waiver advisory source ${waiver.advisorySource}.`);
    }
    if (!validDate(waiver.expiresOn))
      throw new Error("Waiver expiresOn must be a real YYYY-MM-DD date.");
    for (const [key, value] of Object.entries({
      package: expected.package,
      installedVersion: expected.installedVersion,
      ghsa: expected.ghsa,
      cve: expected.cve,
      expiresOn: expected.expiresOn,
      reason: expected.reason,
    })) {
      if (waiver[key] !== value)
        throw new Error(`Waiver ${key} does not match the approved advisory.`);
    }
    validated.set(waiver.advisorySource, waiver);
  }
  return validated;
};

const validateAuditReport = (report) => {
  if (!isRecord(report) || report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)) {
    throw new Error("npm audit returned a malformed version 2 report.");
  }
  const metadata = report.metadata?.vulnerabilities;
  if (!isRecord(metadata) || !Number.isInteger(metadata.total) || metadata.total < 0) {
    throw new Error("npm audit report is missing valid vulnerability metadata.");
  }
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    if (!Number.isInteger(metadata[severity]) || metadata[severity] < 0) {
      throw new Error(`npm audit report has invalid ${severity} metadata.`);
    }
  }
  if (Object.keys(report.vulnerabilities).length === 0 && metadata.total !== 0) {
    throw new Error("npm audit report has a nonzero total without vulnerability records.");
  }
  if (Object.keys(report.vulnerabilities).length > 0 && metadata.total === 0) {
    throw new Error("npm audit report has vulnerability records with a zero total.");
  }
  return report.vulnerabilities;
};

const collectRootAdvisories = (vulnerabilities) => {
  const memo = new Map();
  const advisoryRecords = new Map();

  const resolvePackage = (packageName, ancestors = []) => {
    if (ancestors.includes(packageName)) {
      throw new Error(
        `npm audit vulnerability graph contains an unresolved cycle at ${packageName}.`,
      );
    }
    if (memo.has(packageName)) return memo.get(packageName);

    const record = vulnerabilities[packageName];
    if (
      !isRecord(record) ||
      record.name !== packageName ||
      !Array.isArray(record.via) ||
      record.via.length === 0
    ) {
      throw new Error(`npm audit vulnerability graph cannot resolve ${packageName}.`);
    }

    const roots = new Set();
    for (const via of record.via) {
      if (typeof via === "string") {
        const dependencyRoots = resolvePackage(via, [...ancestors, packageName]);
        for (const source of dependencyRoots) roots.add(source);
        continue;
      }
      if (!isRecord(via) || !Number.isInteger(via.source) || via.source <= 0) {
        throw new Error(`npm audit advisory for ${packageName} has no resolvable source ID.`);
      }
      roots.add(via.source);
      const existing = advisoryRecords.get(via.source);
      if (existing && JSON.stringify(existing) !== JSON.stringify(via)) {
        throw new Error(`npm audit source ${via.source} has conflicting advisory metadata.`);
      }
      advisoryRecords.set(via.source, via);
    }
    if (roots.size === 0)
      throw new Error(`npm audit vulnerability ${packageName} has no root advisory.`);

    memo.set(packageName, roots);
    return roots;
  };

  const allRoots = new Set();
  for (const packageName of Object.keys(vulnerabilities)) {
    for (const source of resolvePackage(packageName)) allRoots.add(source);
  }
  return { rootSources: [...allRoots].sort((left, right) => left - right), advisoryRecords };
};

const validateAdvisoryIdentity = (advisory, source, expected) => {
  if (
    !isRecord(advisory) ||
    advisory.source !== source ||
    advisory.name !== expected.package ||
    advisory.dependency !== expected.package ||
    advisory.url !== expected.url ||
    advisory.range !== expected.range ||
    advisory.severity !== expected.severity
  ) {
    throw new Error(`Root advisory metadata does not match approved ${expected.package} identity.`);
  }
};

const validateInstalledVersions = (installedVersions, expected) => {
  const versions = installedVersions?.[expected.package];
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(`Could not resolve an installed ${expected.package} package version.`);
  }
  if (versions.some((version) => version !== expected.installedVersion)) {
    throw new Error(
      `Installed ${expected.package} version must be exactly ${expected.installedVersion}.`,
    );
  }
};

export const evaluateAuditReport = (
  report,
  { waivers, installedVersions, latestVersion, today = new Date().toISOString().slice(0, 10) },
) => {
  try {
    const vulnerabilities = validateAuditReport(report);
    const validatedWaivers = validateWaivers(waivers);
    if (Object.keys(vulnerabilities).length === 0) {
      if (validatedWaivers.size > 0) {
        return {
          ok: false,
          rootSources: [],
          unwaivedAdvisories: 0,
          waivedAdvisories: 0,
          reason: "audit waiver is no longer needed; remove it",
        };
      }
      return { ok: true, rootSources: [], unwaivedAdvisories: 0, waivedAdvisories: 0 };
    }

    const { rootSources, advisoryRecords } = collectRootAdvisories(vulnerabilities);
    const unknownSources = rootSources.filter((source) => !EXPECTED_ADVISORIES.has(source));
    if (unknownSources.length > 0) {
      throw new Error(`Unexpected root advisory sources: ${rootSources.join(", ") || "none"}.`);
    }
    if (rootSources.length === 0) throw new Error("npm audit reported no root advisory sources.");
    if (!validDate(today)) throw new Error("Current date could not be evaluated.");
    for (const source of rootSources) {
      const expected = EXPECTED_ADVISORIES.get(source);
      const waiver = validatedWaivers.get(source);
      if (!waiver) throw new Error(`No approved waiver is configured for advisory ${source}.`);
      validateAdvisoryIdentity(advisoryRecords.get(source), source, expected);
      validateInstalledVersions(installedVersions, expected);
      if (today > waiver.expiresOn)
        throw new Error(`The advisory waiver expired on ${waiver.expiresOn}.`);
      if (source === 1240992 && latestVersion !== expected.installedVersion) {
        throw new Error(`Registry latest braces version must remain ${expected.installedVersion}.`);
      }
    }
    if (rootSources.length !== validatedWaivers.size) {
      throw new Error("npm audit root advisories and configured approved waivers do not match.");
    }

    return {
      ok: true,
      rootSources,
      unwaivedAdvisories: 0,
      waivedAdvisories: validatedWaivers.size,
      waivers: [...validatedWaivers.values()],
    };
  } catch (error) {
    return {
      ok: false,
      rootSources: [],
      unwaivedAdvisories: 1,
      waivedAdvisories: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

const runNpm = (args, { timeoutMs = 120_000 } = {}) =>
  new Promise((resolve, reject) => {
    const npmCliPath = process.env.npm_execpath;
    if (process.platform === "win32" && !npmCliPath) {
      reject(
        new Error(
          "npm CLI path is unavailable; invoke this gate through npm run audit:dependencies.",
        ),
      );
      return;
    }
    const child = spawn(
      npmCliPath ? process.execPath : "npm",
      npmCliPath ? [npmCliPath, ...args] : args,
      {
        cwd: projectRoot,
        env: process.env,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      settled = true;
      reject(new Error(`npm ${args.join(" ")} timed out.`));
    }, timeoutMs);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.resume();
    child.once("error", (error) =>
      finish(reject, new Error(`Unable to run npm ${args[0]}: ${error.message}`)),
    );
    child.once("close", (code) => finish(resolve, { code, stdout }));
  });

const parseJsonOutput = (output, label) => {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
};

const findInstalledVersions = (tree, packageName) => {
  if (!isRecord(tree)) throw new Error("npm ls returned a malformed dependency tree.");
  const versions = [];
  const visit = (node) => {
    if (!isRecord(node)) throw new Error("npm ls returned a malformed dependency node.");
    for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
      if (!isRecord(dependency))
        throw new Error(`npm ls returned a malformed ${name} dependency node.`);
      if (name === packageName && typeof dependency.version === "string")
        versions.push(dependency.version);
      visit(dependency);
    }
  };
  visit(tree);
  return versions;
};

export const runAuditGate = async ({ today = new Date().toISOString().slice(0, 10) } = {}) => {
  const waiverDefinition = parseJsonOutput(
    await fs.readFile(waiverFilePath, "utf8"),
    "Waiver definition",
  );
  const audit = await runNpm(["audit", "--json"]);
  if (audit.code !== 0 && audit.code !== 1) {
    throw new Error(`npm audit could not complete (exit code ${audit.code ?? "unknown"}).`);
  }
  const report = parseJsonOutput(audit.stdout, "npm audit");
  const auditHasVulnerabilities =
    isRecord(report) &&
    isRecord(report.vulnerabilities) &&
    Object.keys(report.vulnerabilities).length > 0;
  if (audit.code === 1 && !auditHasVulnerabilities) {
    throw new Error("npm audit exited with vulnerabilities but returned no vulnerability records.");
  }
  if (audit.code === 0 && auditHasVulnerabilities) {
    throw new Error("npm audit reported vulnerabilities with a successful exit code.");
  }
  if (!auditHasVulnerabilities) {
    return evaluateAuditReport(report, {
      waivers: waiverDefinition,
      installedVersions: [],
      latestVersion: "",
      today,
    });
  }

  const vulnerabilities = validateAuditReport(report);
  const { rootSources } = collectRootAdvisories(vulnerabilities);
  if (rootSources.some((source) => !EXPECTED_ADVISORIES.has(source))) {
    return evaluateAuditReport(report, {
      waivers: waiverDefinition,
      installedVersions: {},
      latestVersion: "",
      today,
    });
  }
  const installedVersions = {};
  for (const source of rootSources) {
    const expected = EXPECTED_ADVISORIES.get(source);
    const installed = await runNpm(["ls", expected.package, "--all", "--json"]);
    if (installed.code !== 0)
      throw new Error(
        `npm ls ${expected.package} could not complete (exit code ${installed.code}).`,
      );
    installedVersions[expected.package] = findInstalledVersions(
      parseJsonOutput(installed.stdout, "npm ls"),
      expected.package,
    );
  }
  let latestVersion = "";
  if (rootSources.includes(1240992)) {
    const latest = await runNpm(["view", "braces", "dist-tags.latest", "--json"]);
    if (latest.code !== 0)
      throw new Error(`npm view braces could not complete (exit code ${latest.code}).`);
    latestVersion = parseJsonOutput(latest.stdout, "npm view braces");
    if (typeof latestVersion !== "string")
      throw new Error("npm view braces returned no latest version.");
  }

  return evaluateAuditReport(report, {
    waivers: waiverDefinition,
    installedVersions,
    latestVersion,
    today,
  });
};

export const main = async () => {
  try {
    const result = await runAuditGate();
    if (!result.ok) {
      console.error(`npm audit: FAIL — ${result.reason}`);
      console.error(`unwaived advisories: ${result.unwaivedAdvisories}`);
      process.exitCode = 1;
      return;
    }
    if (result.waivedAdvisories > 0) {
      console.log(`npm audit: ${result.waivedAdvisories} known root advisories temporarily waived`);
      for (const waiver of result.waivers) {
        console.log(`${waiver.ghsa} / ${waiver.package}@${waiver.installedVersion}`);
        console.log(`expires: ${waiver.expiresOn}`);
      }
    } else {
      console.log("npm audit: 0 known root advisories");
    }
    console.log(`unwaived advisories: ${result.unwaivedAdvisories}`);
  } catch (error) {
    console.error(`npm audit: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

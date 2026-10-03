import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const waiverFilePath = path.join(projectRoot, "security", "npm-audit-waivers.json");
const EXPECTED_ADVISORY = {
  source: 1240992,
  package: "braces",
  version: "3.0.3",
  ghsa: "GHSA-vfj7-8cjw-p6xm",
  cve: "CVE-2026-93687",
  url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  range: "<=3.0.3",
  reason: "no-official-fixed-release",
};

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
  if (!Array.isArray(definition.waivers) || definition.waivers.length > 1) {
    throw new Error("At most one structured advisory waiver is allowed.");
  }
  if (definition.waivers.length === 0) return null;

  const [waiver] = definition.waivers;
  if (!isRecord(waiver)) throw new Error("Waiver entry must be an object.");
  const allowedKeys = new Set([
    "advisorySource",
    "package",
    "installedVersion",
    "ghsa",
    "cve",
    "expiresOn",
    "reason",
  ]);
  if (Object.keys(waiver).some((key) => !allowedKeys.has(key))) {
    throw new Error("Waiver entry contains an unknown field.");
  }
  for (const [key, expected] of Object.entries({
    advisorySource: EXPECTED_ADVISORY.source,
    package: EXPECTED_ADVISORY.package,
    installedVersion: EXPECTED_ADVISORY.version,
    ghsa: EXPECTED_ADVISORY.ghsa,
    cve: EXPECTED_ADVISORY.cve,
    reason: EXPECTED_ADVISORY.reason,
  })) {
    if (waiver[key] !== expected)
      throw new Error(`Waiver ${key} does not match the approved advisory.`);
  }
  if (!validDate(waiver.expiresOn))
    throw new Error("Waiver expiresOn must be a real YYYY-MM-DD date.");

  return waiver;
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

const validateAdvisoryIdentity = (advisory) => {
  if (
    advisory.name !== EXPECTED_ADVISORY.package ||
    advisory.dependency !== EXPECTED_ADVISORY.package ||
    advisory.url !== EXPECTED_ADVISORY.url ||
    advisory.range !== EXPECTED_ADVISORY.range ||
    advisory.severity !== "high"
  ) {
    throw new Error("Root advisory metadata does not match the approved braces advisory identity.");
  }
};

const validateInstalledVersions = (installedVersions) => {
  if (!Array.isArray(installedVersions) || installedVersions.length === 0) {
    throw new Error("Could not resolve an installed braces package version.");
  }
  if (installedVersions.some((version) => version !== EXPECTED_ADVISORY.version)) {
    throw new Error(`Installed braces version must be exactly ${EXPECTED_ADVISORY.version}.`);
  }
};

export const evaluateAuditReport = (
  report,
  { waivers, installedVersions, latestVersion, today = new Date().toISOString().slice(0, 10) },
) => {
  try {
    const vulnerabilities = validateAuditReport(report);
    const waiver = validateWaivers(waivers);
    if (Object.keys(vulnerabilities).length === 0) {
      if (waiver) {
        return {
          ok: false,
          rootSources: [],
          unwaivedAdvisories: 0,
          waiver: null,
          reason: "audit waiver is no longer needed; remove it",
        };
      }
      return { ok: true, rootSources: [], unwaivedAdvisories: 0, waiver: null };
    }

    if (!waiver)
      throw new Error("npm audit reported vulnerabilities but no approved waiver is configured.");
    const { rootSources, advisoryRecords } = collectRootAdvisories(vulnerabilities);
    if (rootSources.length !== 1 || rootSources[0] !== EXPECTED_ADVISORY.source) {
      throw new Error(`Unexpected root advisory sources: ${rootSources.join(", ") || "none"}.`);
    }
    validateAdvisoryIdentity(advisoryRecords.get(EXPECTED_ADVISORY.source));
    validateInstalledVersions(installedVersions);
    if (latestVersion !== EXPECTED_ADVISORY.version) {
      throw new Error(`Registry latest braces version must remain ${EXPECTED_ADVISORY.version}.`);
    }
    if (!validDate(today)) throw new Error("Current date could not be evaluated.");
    if (today > waiver.expiresOn)
      throw new Error(`The advisory waiver expired on ${waiver.expiresOn}.`);

    return { ok: true, rootSources, unwaivedAdvisories: 0, waiver };
  } catch (error) {
    return {
      ok: false,
      rootSources: [],
      unwaivedAdvisories: 1,
      waiver: null,
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

  const installed = await runNpm(["ls", "braces", "--all", "--json"]);
  if (installed.code !== 0)
    throw new Error(`npm ls braces could not complete (exit code ${installed.code}).`);
  const installedVersions = findInstalledVersions(
    parseJsonOutput(installed.stdout, "npm ls"),
    "braces",
  );
  const latest = await runNpm(["view", "braces", "dist-tags.latest", "--json"]);
  if (latest.code !== 0)
    throw new Error(`npm view braces could not complete (exit code ${latest.code}).`);
  const latestVersion = parseJsonOutput(latest.stdout, "npm view braces");
  if (typeof latestVersion !== "string")
    throw new Error("npm view braces returned no latest version.");

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
    if (result.waiver) {
      console.log("npm audit: 1 known root advisory temporarily waived");
      console.log(
        `${result.waiver.ghsa} / ${result.waiver.package}@${result.waiver.installedVersion}`,
      );
      console.log(`expires: ${result.waiver.expiresOn}`);
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

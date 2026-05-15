import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const gitCommand = isWindows ? "git.exe" : "git";

const runSharedTests = (runNumber) =>
  new Promise((resolve, reject) => {
    console.log(`[verify:repeat-clean] Running shared tests (${runNumber}/2)...`);
    const command = isWindows ? "cmd.exe" : npmCommand;
    const args = isWindows
      ? ["/d", "/s", "/c", `${npmCommand} run test:shared`]
      : ["run", "test:shared"];
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

const getGitStatusLines = () => {
  const result = spawnSync(gitCommand, ["status", "--porcelain"], {
    encoding: "utf8",
    env: { ...process.env, GIT_MASTER: "1" },
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    if (result.stderr?.trim()) {
      console.error(result.stderr.trim());
    }
    throw new Error(`git status --porcelain failed with exit code ${result.status}`);
  }

  return (result.stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);
};

const printLines = (lines) => {
  for (const line of lines) {
    console.error(line);
  }
};

const assertStatusUnchangedAfterRun = (runNumber, baselineLines) => {
  const statusLines = getGitStatusLines();
  const baseline = new Set(baselineLines);
  const newLines = statusLines.filter((line) => !baseline.has(line));
  const removedLines = baselineLines.filter((line) => !statusLines.includes(line));

  if (newLines.length > 0 || removedLines.length > 0) {
    if (newLines.length > 0) {
      printLines(newLines);
    }
    if (removedLines.length > 0) {
      console.error("Baseline status entries changed during test run:");
      printLines(removedLines);
    }
    console.error(`Workspace residue detected after test run ${runNumber}`);
    process.exit(1);
  }
};

const baselineLines = getGitStatusLines();
if (baselineLines.length > 0) {
  console.warn("Warning: workspace was not clean before repeat-clean verification:");
  for (const line of baselineLines) {
    console.warn(line);
  }
}

for (const runNumber of [1, 2]) {
  const exitCode = await runSharedTests(runNumber);
  if (exitCode !== 0) {
    console.error(`npm run test:shared failed during run ${runNumber}`);
    process.exit(1);
  }
  assertStatusUnchangedAfterRun(runNumber, baselineLines);
}

console.log("Shared tests passed twice with no workspace residue.");

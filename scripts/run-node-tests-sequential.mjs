import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { cleanupWorktreeDevProcesses } from "../tests/test-harness-env.mjs";

const testFiles = process.argv.slice(2);

const killLeftoverPlaywrightChromium = () => {
  if (process.platform !== "win32") {
    return;
  }

  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name = 'chrome-headless-shell.exe'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ],
    { stdio: "ignore", windowsHide: true },
  );
};

const killLeftoverWorktreeDevProcesses = () => {
  cleanupWorktreeDevProcesses();
};

if (testFiles.length === 0) {
  console.error("Usage: node scripts/run-node-tests-sequential.mjs <test-file> [...test-file]");
  process.exit(1);
}

const runTestFile = (testFile) =>
  new Promise((resolve, reject) => {
    console.log(`[node-test-sequential] ${testFile}`);
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", testFile], {
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

for (const testFile of testFiles) {
  killLeftoverWorktreeDevProcesses();
  killLeftoverPlaywrightChromium();
  const exitCode = await runTestFile(testFile);
  killLeftoverPlaywrightChromium();
  killLeftoverWorktreeDevProcesses();
  if (exitCode !== 0) {
    console.error(`[node-test-sequential] ${testFile} failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

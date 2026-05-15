import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanupWorktreeDevProcesses } from "./test-harness-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const waitForExit = (child, { timeoutMs = 10_000 } = {}) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Process ${child.pid ?? "unknown"} did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

test("cleanupWorktreeDevProcesses kills leftover run-dev descendants in this worktree", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-specific cleanup uses PowerShell process discovery");
    return;
  }

  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)", path.join(projectRoot, "scripts", "run-dev.mjs")],
    {
      cwd: projectRoot,
      stdio: "ignore",
      windowsHide: true,
    },
  );

  assert.equal(typeof child.pid, "number");
  try {
    cleanupWorktreeDevProcesses({ projectRoot, timeoutSeconds: 5 });
    await waitForExit(child);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});

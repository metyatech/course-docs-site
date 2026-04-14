import { spawn } from "node:child_process";
import { createIsolatedNextDistDir, DEFAULT_NEXT_DIST_DIR } from "../scripts/next-dist-dir.mjs";

export const createRunDevTestEnv = ({ label, env = process.env, overrides = {} }) => ({
  ...env,
  NEXT_TELEMETRY_DISABLED: "1",
  COURSE_DOCS_NEXT_DIST_DIR: createIsolatedNextDistDir(label),
  ...overrides,
});

export const createPlaywrightWebServerEnv = ({ label, env = process.env, overrides = {} }) => ({
  ...env,
  COURSE_DOCS_NEXT_DIST_DIR: env.COURSE_DOCS_NEXT_DIST_DIR ?? createIsolatedNextDistDir(label),
  ...overrides,
});

/**
 * Kill a spawned process together with its descendants, waiting for the
 * kernel to actually release the PID so the next test's build can claim
 * any file handles the Next.js worker pool was holding.
 *
 * On Windows a Node `child.kill()` only terminates the direct PID; Next
 * spawns worker processes that survive unless taskkill is run with /T /F
 * AND its exit is awaited. Earlier local helpers in each test file were
 * fire-and-forget, leaving orphaned workers that slowed subsequent test
 * builds (the shared `.next-test` dist dir would still be locked while
 * the next test tried to build into it). This helper is the single
 * tested implementation used by all harness consumers.
 */
export const killProcessTree = async (child) => {
  if (!child || child.pid == null) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  const waitForExit = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.once("close", () => resolve());
  });

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        const tk = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        tk.once("close", finish);
        tk.once("error", finish);
      } catch {
        finish();
      }
      // Hard cap so the helper never hangs the test runner if taskkill stalls.
      setTimeout(finish, 10_000);
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  await Promise.race([
    waitForExit,
    new Promise((resolve) => setTimeout(resolve, 15_000)),
  ]);
};

export { DEFAULT_NEXT_DIST_DIR };

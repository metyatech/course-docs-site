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
 * Spawn `scripts/run-dev.mjs` (or any equivalent dev launcher) so it can be
 * killed with its full descendant tree.
 *
 * On POSIX the child is started with `detached: true` so it becomes the leader
 * of its own process group. `killProcessTree()` can then signal the entire
 * group via `process.kill(-pid, ...)`. Without this, sending a signal to the
 * direct child only kills `run-dev` itself; the `next dev` worker it spawned
 * survives, holds the listening port, and (because Node's test runner waits
 * for any cleanup hook to settle) can hang the suite indefinitely on CI.
 *
 * On Windows `detached` is not used; cleanup happens through `taskkill /T /F`.
 */
export const spawnRunDevForTest = ({
  projectRoot,
  port,
  env,
  args = [],
  scriptPath = "scripts/run-dev.mjs",
  stdio = "inherit",
}) =>
  spawn(
    process.execPath,
    [scriptPath, "--port", String(port), ...args],
    {
      cwd: projectRoot,
      env,
      stdio,
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );

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
 *
 * On POSIX the child must have been spawned with `detached: true` (use
 * {@link spawnRunDevForTest}) so its PID is also a process group ID. The
 * helper sends SIGTERM to the group, waits up to 5s for clean shutdown,
 * then escalates to SIGKILL. If the negative-pid signal fails (child was
 * not detached) it falls back to signalling the direct child only.
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
    let signalledGroup = false;
    try {
      process.kill(-child.pid, "SIGTERM");
      signalledGroup = true;
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }

    // Give the process tree a bounded window to exit cleanly. If it does not,
    // escalate to SIGKILL on the same target (group if we managed to signal
    // the group, otherwise the direct child).
    await Promise.race([
      waitForExit,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);

    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (signalledGroup) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
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

/**
 * Close a Playwright browser within a bounded time window so a hung
 * Chromium does not stall the test runner. If `browser.close()` does not
 * settle within `timeoutMs`, the helper resolves anyway and best-effort
 * kills the underlying browser process so cleanup hooks return.
 */
export const closeBrowserBounded = async (browser, { timeoutMs = 30_000 } = {}) => {
  if (!browser) return;

  const closePromise = (async () => {
    try {
      await browser.close();
    } catch {
      // already closed
    }
  })();

  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    timer.unref?.();
  });

  const outcome = await Promise.race([
    closePromise.then(() => "closed"),
    timeoutPromise,
  ]);
  clearTimeout(timer);

  if (outcome !== "closed") {
    // Best-effort: Playwright exposes the underlying child process via
    // `browser.process()` for non-remote browsers. Walk that to kill the
    // tree so the listening Chromium does not keep the runner alive.
    try {
      const proc = typeof browser.process === "function" ? browser.process() : null;
      if (proc) {
        await killProcessTree(proc);
      }
    } catch {
      // ignore
    }
  }
};

/**
 * Wait for a child process to exit with a deterministic deadline. If it
 * does not exit within `timeoutMs`, kill its tree and reject. Without this
 * shim, `child.once("exit", ...)` waits forever on a hung sync/build child.
 */
export const waitForProcessExit = async (child, label, { timeoutMs = 120_000 } = {}) => {
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      const onExit = (code, signal) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `${label} exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`,
            ),
          );
        }
      };
      child.once("error", reject);
      child.once("exit", onExit);

      timer = setTimeout(async () => {
        child.removeListener("exit", onExit);
        try {
          await killProcessTree(child);
        } catch {
          // ignore
        }
        reject(new Error(`${label} did not exit within ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref?.();
    });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Poll an HTTP endpoint until the dev server responds. The fetch itself is
 * abort-bounded (10s per attempt) and the outer loop has a hard `timeoutMs`
 * deadline. On timeout the dev process tree is killed so the cleanup hook
 * does not later block on an unresponsive child.
 */
export const waitForDevServerReady = async ({
  child,
  url,
  timeoutMs = 60_000,
  intervalMs = 500,
  signal,
  acceptStatuses = new Set([200, 301, 302, 307, 308]),
}) => {
  const startedAt = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Dev server readiness wait aborted");
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Dev server exited before becoming ready: ${child.exitCode ?? child.signalCode}`,
      );
    }

    if (Date.now() - startedAt > timeoutMs) {
      try {
        await killProcessTree(child);
      } catch {
        // ignore
      }
      throw new Error(`Dev server did not become ready within ${timeoutMs} ms: ${url}`);
    }

    try {
      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000);
      const response = await fetch(url, { redirect: "manual", signal: fetchSignal });
      if (acceptStatuses.has(response.status)) {
        return response;
      }
    } catch {
      // retry until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

/**
 * Run a subtest body under a hard deadline that cannot be exceeded by any
 * inner await. The body receives an AbortSignal it can pass into network
 * polling helpers so they bail at the same instant the deadline fires.
 *
 * Use this when a subtest spawns external processes or browsers whose
 * built-in timeouts are not authoritative.
 */
export const runWithSubtestDeadline = async (timeoutMs, body) => {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Subtest exceeded hard timeout (${timeoutMs} ms)`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([Promise.resolve(body(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
};

export { DEFAULT_NEXT_DIST_DIR };

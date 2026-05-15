import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getRequiredContentSourceText, parseContentSource } from "./content-source.mjs";
import { isCustomNextDistDir, resolveNextDistDirPath } from "./next-dist-dir.mjs";
import { findFirstFreePort, waitForPortFree } from "./port-availability.mjs";

const args = process.argv.slice(2);
const projectRoot = process.cwd();
const envFileRoot = path.resolve(projectRoot, process.env.COURSE_DOCS_ENV_FILE_DIR ?? ".");

const devInnerMode = (process.env.COURSE_DOCS_SITE_DEV_INNER ?? "").trim();
const isWindows = process.platform === "win32";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const parsePortArg = (argv) => {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--port" || a === "-p") {
      const v = argv[i + 1];
      if (typeof v === "string" && v.trim()) {
        const port = Number(v);
        if (Number.isFinite(port) && port > 0) {
          return port;
        }
      }
    }
    if (typeof a === "string" && a.startsWith("--port=")) {
      const v = a.slice("--port=".length);
      const port = Number(v);
      if (Number.isFinite(port) && port > 0) {
        return port;
      }
    }
  }
  return null;
};

const stripPortArgs = (argv) => {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--port" || a === "-p") {
      i += 1;
      continue;
    }
    if (typeof a === "string" && a.startsWith("--port=")) {
      continue;
    }
    out.push(a);
  }
  return out;
};

const readEnvFile = (filename) => {
  const envPath = path.join(envFileRoot, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return dotenv.parse(fs.readFileSync(envPath));
  } catch {
    return {};
  }
};

const getRuntimeEnv = () => ({
  ...readEnvFile(".env"),
  ...readEnvFile(".env.local"),
  ...readEnvFile(".env.course"),
  ...readEnvFile(".env.course.local"),
  ...process.env,
});

const normalizeCourseEnv = (env) => {
  const sourceText = getRequiredContentSourceText(env);
  const source = parseContentSource(sourceText);
  const sourceRoot = source.kind === "local" ? path.resolve(projectRoot, source.localDir) : null;
  const sourceId =
    source.kind === "local" ? `dir:${sourceRoot}` : `repo:${source.repo}#${source.ref}`;

  return {
    sourceId,
    source,
    sourceRoot,
  };
};

const getCourseEnv = () => {
  return normalizeCourseEnv(getRuntimeEnv());
};

const getNextDistDirPath = () => resolveNextDistDirPath({ projectRoot, env: getRuntimeEnv() });
const shouldResetNextDistDirOnStart = () =>
  isCustomNextDistDir({ projectRoot, env: getRuntimeEnv() });

let lastCourseEnv = getCourseEnv();
const portPreference = parsePortArg(args) ?? 3000;
const baseArgs = stripPortArgs(args);
let activePort = null;

let syncRunning = false;
let syncQueued = false;
let restarting = false;
let restartQueued = false;
let devProcess = null;
let devExitExpected = false;
let shuttingDown = false;
let devRevision = crypto.randomUUID();
let sourceWatcher = null;

const runSync = () =>
  new Promise((resolve) => {
    const childEnv = { ...process.env };
    if (devProcess) {
      childEnv.COURSE_DOCS_SKIP_NEXT_DIST_CLEAR = "1";
    }
    const child = spawn(process.execPath, ["scripts/sync-course-content.mjs"], {
      stdio: "inherit",
      env: childEnv,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });

const startDev = () => {
  devExitExpected = false;
  const devArgs = [...baseArgs, "--port", String(activePort)];
  const childEnv = {
    ...getRuntimeEnv(),
    COURSE_DOCS_SITE_DEV_REVISION: devRevision,
  };
  if (devInnerMode === "stub") {
    devProcess = spawn(process.execPath, ["scripts/dev-inner-stub.mjs", ...devArgs], {
      stdio: "inherit",
      env: childEnv,
    });
  } else {
    devProcess = spawn(process.execPath, [nextBin, "dev", ...devArgs], {
      stdio: "inherit",
      env: childEnv,
    });
  }
  devProcess.on("exit", (devCode) => {
    if (devExitExpected) {
      return;
    }
    process.exit(devCode ?? 1);
  });
};

const stopDev = async () => {
  if (!devProcess) {
    return;
  }

  const proc = devProcess;
  devProcess = null;
  devExitExpected = true;

  const exited = new Promise((resolve) => proc.on("exit", () => resolve()));
  try {
    proc.kill();
  } catch {
    // ignore
  }

  if (isWindows) {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      try {
        // Kill process tree (node/next workers) on Windows and wait until
        // taskkill finishes so the next fixture cannot race a live worker.
        const killer = spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once("close", finish);
        killer.once("error", finish);
      } catch {
        finish();
      }
      setTimeout(finish, 10_000);
    });
  } else {
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 5000);
  }

  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
};

const queueSync = async () => {
  syncQueued = true;
  if (syncRunning) {
    return;
  }

  syncRunning = true;
  while (syncQueued) {
    syncQueued = false;
    const exitCode = await runSync();
    if (exitCode !== 0) {
      syncRunning = false;
      process.exit(exitCode);
      return;
    }
    lastCourseEnv = getCourseEnv();
  }
  syncRunning = false;
};

const rmIfExists = (targetPath) => {
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
      return;
    }
  } catch {
    // ignore
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const normalizeWatcherPath = (filename) => String(filename ?? "").replace(/\\/g, "/");

const isRelevantSourceChangePath = (filename) => {
  const normalized = normalizeWatcherPath(filename);
  if (!normalized) {
    return true;
  }
  return (
    normalized === "site.config.ts" ||
    normalized === "content" ||
    normalized.startsWith("content/") ||
    normalized === "public" ||
    normalized.startsWith("public/")
  );
};

const collectDirectoryTree = (rootDir, directories = new Set()) => {
  try {
    const st = fs.lstatSync(rootDir);
    if (!st.isDirectory() || st.isSymbolicLink()) {
      return directories;
    }
  } catch {
    return directories;
  }

  directories.add(rootDir);
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      collectDirectoryTree(path.join(rootDir, entry.name), directories);
    }
  }
  return directories;
};

const createLocalSourceWatcher = ({ sourceRoot, onChange }) => {
  let debounceTimer = null;
  let refreshTimer = null;
  let recursiveWatcher = null;
  let rootWatcher = null;
  const treeWatchers = new Map();

  const scheduleSync = (filename) => {
    if (restarting || restartQueued || shuttingDown) {
      return;
    }
    if (!isRelevantSourceChangePath(filename)) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void onChange();
    }, 150);
  };

  const closeTreeWatchers = () => {
    for (const watcher of treeWatchers.values()) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    treeWatchers.clear();
  };

  const scheduleRefresh = () => {
    if (refreshTimer) {
      return;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshTreeWatchers();
    }, 150);
  };

  const refreshTreeWatchers = () => {
    const desiredDirs = new Set();
    collectDirectoryTree(path.join(sourceRoot, "content"), desiredDirs);
    collectDirectoryTree(path.join(sourceRoot, "public"), desiredDirs);

    for (const [dirPath, watcher] of treeWatchers.entries()) {
      if (desiredDirs.has(dirPath)) {
        continue;
      }
      try {
        watcher.close();
      } catch {
        // ignore
      }
      treeWatchers.delete(dirPath);
    }

    for (const dirPath of desiredDirs) {
      if (treeWatchers.has(dirPath)) {
        continue;
      }
      try {
        const watcher = fs.watch(dirPath, () => {
          scheduleSync(dirPath);
          scheduleRefresh();
        });
        watcher.on("error", () => {
          // ignore transient watcher failures; the next refresh will rebuild state.
        });
        treeWatchers.set(dirPath, watcher);
      } catch {
        // ignore
      }
    }
  };

  try {
    recursiveWatcher = fs.watch(sourceRoot, { recursive: true }, (_eventType, filename) => {
      scheduleSync(filename);
    });
    recursiveWatcher.on("error", () => {
      // ignore
    });
  } catch {
    recursiveWatcher = null;
  }

  if (!recursiveWatcher) {
    try {
      rootWatcher = fs.watch(sourceRoot, (_eventType, filename) => {
        scheduleSync(filename);
        const normalized = normalizeWatcherPath(filename);
        if (
          normalized === "content" ||
          normalized.startsWith("content/") ||
          normalized === "public" ||
          normalized.startsWith("public/")
        ) {
          scheduleRefresh();
        }
      });
      rootWatcher.on("error", () => {
        // ignore
      });
    } catch {
      rootWatcher = null;
    }

    refreshTreeWatchers();
  }

  return {
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      if (recursiveWatcher) {
        try {
          recursiveWatcher.close();
        } catch {
          // ignore
        }
      }
      if (rootWatcher) {
        try {
          rootWatcher.close();
        } catch {
          // ignore
        }
      }
      closeTreeWatchers();
    },
  };
};

const replaceSourceWatcher = () => {
  if (sourceWatcher) {
    sourceWatcher.close();
    sourceWatcher = null;
  }

  const nextCourseEnv = getCourseEnv();
  if (nextCourseEnv.source.kind !== "local" || !nextCourseEnv.sourceRoot) {
    return;
  }

  sourceWatcher = createLocalSourceWatcher({
    sourceRoot: nextCourseEnv.sourceRoot,
    onChange: queueSync,
  });
};

const queueRestart = async () => {
  restartQueued = true;
  if (restarting) {
    return;
  }

  restarting = true;
  while (restartQueued) {
    restartQueued = false;

    await stopDev();
    try {
      await waitForPortFree(activePort);
    } catch (error) {
      // If something else grabbed the port, pick a new one rather than silently starting on a different port.
      // This keeps restarts predictable and prevents two dev servers from racing for different ports.
      const previousPort = activePort;
      activePort = await findFirstFreePort(portPreference);
      console.warn(
        `Warning: could not reuse port ${previousPort}; restarting on port ${activePort}. (${error})`,
      );
    }
    await queueSync();
    replaceSourceWatcher();

    // Switching course content can change the MDX tree and page-map.
    // Clear Next's dev cache to avoid cross-course stale artifacts.
    rmIfExists(getNextDistDirPath());

    devRevision = crypto.randomUUID();
    startDev();
  }
  restarting = false;
};

const createEnvWatcher = () => {
  let debounceTimer;

  const schedule = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      const nextCourseEnv = getCourseEnv();
      const changed = nextCourseEnv.sourceId !== lastCourseEnv.sourceId;
      if (!changed) {
        return;
      }
      await queueRestart();
    }, 250);
  };

  const watchFiles = [".env", ".env.local", ".env.course", ".env.course.local"].map((f) =>
    path.join(envFileRoot, f),
  );

  // `fs.watch()` is not reliable with atomic save patterns (common on Windows).
  // Use polling-based watchers for env files to ensure course switching always triggers.
  for (const filePath of watchFiles) {
    fs.watchFile(filePath, { interval: 250 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) {
        return;
      }
      schedule();
    });
  }

  return {
    close: () => {
      for (const filePath of watchFiles) {
        fs.unwatchFile(filePath);
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  };
};

queueSync().then(async () => {
  replaceSourceWatcher();
  activePort = await findFirstFreePort(portPreference);
  const envWatcher = createEnvWatcher();
  if (shouldResetNextDistDirOnStart()) {
    rmIfExists(getNextDistDirPath());
  }
  startDev();

  const closeAll = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    envWatcher.close();
    if (sourceWatcher) {
      sourceWatcher.close();
      sourceWatcher = null;
    }
    await stopDev();
    process.exit(0);
  };

  process.on("SIGINT", () => void closeAll());
  process.on("SIGTERM", () => void closeAll());
});

process.on("exit", () => {
  if (devProcess && devProcess.pid) {
    try {
      if (isWindows) {
        spawnSync("taskkill", ["/PID", String(devProcess.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        devProcess.kill("SIGKILL");
      }
    } catch {
      // ignore
    }
  }
});

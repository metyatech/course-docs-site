import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const projectRoot = process.cwd();

const devInnerMode = (process.env.COURSE_DOCS_SITE_DEV_INNER ?? '').trim();
const isWindows = process.platform === 'win32';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const readEnvFile = (filename) => {
  const envPath = path.join(projectRoot, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return dotenv.parse(fs.readFileSync(envPath));
  } catch {
    return {};
  }
};

const normalizeCourseEnv = (env) => {
  const dirRaw = typeof env.COURSE_CONTENT_DIR === 'string' ? env.COURSE_CONTENT_DIR.trim() : '';
  const dir = dirRaw ? path.resolve(projectRoot, dirRaw) : '';

  const repo = typeof env.COURSE_CONTENT_REPO === 'string' ? env.COURSE_CONTENT_REPO.trim() : '';
  const ref = typeof env.COURSE_CONTENT_REF === 'string' ? env.COURSE_CONTENT_REF.trim() : '';

  return {
    dir,
    repo,
    ref,
  };
};

const getCourseEnv = () => {
  const fromDotEnv = readEnvFile('.env');
  const fromDotEnvLocal = readEnvFile('.env.local');
  const fromCourseEnv = readEnvFile('.env.course');
  const fromCourseEnvLocal = readEnvFile('.env.course.local');
  const fromEnv = { ...process.env };

  // process.env wins over files
  return normalizeCourseEnv({
    ...fromDotEnv,
    ...fromDotEnvLocal,
    ...fromCourseEnv,
    ...fromCourseEnvLocal,
    ...fromEnv,
  });
};

let lastCourseEnv = getCourseEnv();
const desiredPort = (() => {
  const idxLong = args.indexOf('--port');
  if (idxLong !== -1 && typeof args[idxLong + 1] === 'string') {
    const p = Number(args[idxLong + 1]);
    return Number.isFinite(p) && p > 0 ? p : 3000;
  }
  const idxShort = args.indexOf('-p');
  if (idxShort !== -1 && typeof args[idxShort + 1] === 'string') {
    const p = Number(args[idxShort + 1]);
    return Number.isFinite(p) && p > 0 ? p : 3000;
  }
  return 3000;
})();

let syncRunning = false;
let syncQueued = false;
let restarting = false;
let restartQueued = false;
let devProcess = null;
let devExitExpected = false;
let shuttingDown = false;

const runSync = () =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/sync-course-content.mjs'], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });

const startDev = () => {
  devExitExpected = false;
  if (devInnerMode === 'stub') {
    devProcess = spawn(process.execPath, ['scripts/dev-inner-stub.mjs', ...args], {
      stdio: 'inherit',
    });
  } else {
    devProcess = spawn(process.execPath, [nextBin, 'dev', ...args], { stdio: 'inherit' });
  }
  devProcess.on('exit', (devCode) => {
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

  const exited = new Promise((resolve) => proc.on('exit', () => resolve()));
  try {
    proc.kill();
  } catch {
    // ignore
  }

  if (isWindows) {
    try {
      // Kill process tree (node/next workers) on Windows.
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ignore
    }
  } else {
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
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

const waitForPortFree = async (port, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Port ${port} is still in use after restart. Stop the old dev server and retry.`);
    }

    // eslint-disable-next-line no-await-in-loop
    const canListen = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });

    if (canListen) {
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
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
    await waitForPortFree(desiredPort);
    await queueSync();

    // Switching course content can change the MDX tree and page-map.
    // Clear Next's dev cache to avoid cross-course stale artifacts.
    rmIfExists(path.join(projectRoot, '.next'));

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
      const changed =
        nextCourseEnv.dir !== lastCourseEnv.dir ||
        nextCourseEnv.repo !== lastCourseEnv.repo ||
        nextCourseEnv.ref !== lastCourseEnv.ref;
      if (!changed) {
        return;
      }
      await queueRestart();
    }, 250);
  };

  const watchFiles = ['.env', '.env.local', '.env.course', '.env.course.local'].map((f) =>
    path.join(projectRoot, f)
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

queueSync().then(() => {
  const envWatcher = createEnvWatcher();
  startDev();

  const closeAll = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    envWatcher.close();
    await stopDev();
    process.exit(0);
  };

  process.on('SIGINT', () => void closeAll());
  process.on('SIGTERM', () => void closeAll());
});

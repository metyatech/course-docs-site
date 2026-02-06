import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  DEFAULT_COURSE_CONTENT_SOURCE,
  parseContentSource,
} from './content-source.mjs';

const args = process.argv.slice(2);
const projectRoot = process.cwd();

const devInnerMode = (process.env.COURSE_DOCS_SITE_DEV_INNER ?? '').trim();
const isWindows = process.platform === 'win32';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const parsePortArg = (argv) => {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      const v = argv[i + 1];
      if (typeof v === 'string' && v.trim()) {
        const port = Number(v);
        if (Number.isFinite(port) && port > 0) {
          return port;
        }
      }
    }
    if (typeof a === 'string' && a.startsWith('--port=')) {
      const v = a.slice('--port='.length);
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
    if (a === '--port' || a === '-p') {
      i += 1;
      continue;
    }
    if (typeof a === 'string' && a.startsWith('--port=')) {
      continue;
    }
    out.push(a);
  }
  return out;
};

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
  const sourceRaw =
    typeof env.COURSE_CONTENT_SOURCE === 'string' ? env.COURSE_CONTENT_SOURCE.trim() : '';
  const sourceText = sourceRaw || DEFAULT_COURSE_CONTENT_SOURCE;
  const source = parseContentSource(sourceText);
  const sourceId =
    source.kind === 'local'
      ? `dir:${path.resolve(projectRoot, source.localDir)}`
      : `repo:${source.repo}#${source.ref}`;

  return {
    sourceId,
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

const runSync = () =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/sync-course-content.mjs'], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });

const startDev = () => {
  devExitExpected = false;
  const devArgs = [...baseArgs, '--port', String(activePort)];
  const childEnv = {
    ...process.env,
    COURSE_DOCS_SITE_DEV_REVISION: devRevision,
  };
  if (devInnerMode === 'stub') {
    devProcess = spawn(process.execPath, ['scripts/dev-inner-stub.mjs', ...devArgs], {
      stdio: 'inherit',
      env: childEnv,
    });
  } else {
    devProcess = spawn(process.execPath, [nextBin, 'dev', ...devArgs], {
      stdio: 'inherit',
      env: childEnv,
    });
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

const findFirstFreePort = async (fromPort, maxAttempts = 20) => {
  for (let i = 0; i < maxAttempts; i += 1) {
    const port = fromPort + i;
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
      return port;
    }
  }
  throw new Error(`No free port found starting from ${fromPort}.`);
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
        `Warning: could not reuse port ${previousPort}; restarting on port ${activePort}. (${error})`
      );
    }
    await queueSync();

    // Switching course content can change the MDX tree and page-map.
    // Clear Next's dev cache to avoid cross-course stale artifacts.
    rmIfExists(path.join(projectRoot, '.next'));

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

queueSync().then(async () => {
  activePort = await findFirstFreePort(portPreference);
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

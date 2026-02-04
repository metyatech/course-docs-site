import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const projectRoot = process.cwd();

const isWindows = process.platform === 'win32';
const command = isWindows ? 'cmd.exe' : 'npm';
const npmArgs = isWindows ? ['/c', 'npm', 'run'] : ['run'];

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
  const fromEnv = { ...process.env };
  const fromDotEnv = readEnvFile('.env');
  const fromDotEnvLocal = readEnvFile('.env.local');
  return normalizeCourseEnv({ ...fromEnv, ...fromDotEnv, ...fromDotEnvLocal });
};

let lastCourseEnv = getCourseEnv();
let syncRunning = false;
let syncQueued = false;

const runSync = () =>
  new Promise((resolve) => {
    const child = spawn(command, [...npmArgs, 'sync:content'], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

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
      await queueSync();
    }, 250);
  };

  const watcher = fs.watch(projectRoot, { persistent: true }, (_eventType, filename) => {
    if (!filename) {
      schedule();
      return;
    }
    if (filename === '.env' || filename === '.env.local') {
      schedule();
    }
  });

  return {
    close: () => {
      watcher.close();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  };
};

queueSync().then(() => {
  const envWatcher = createEnvWatcher();

  const dev = spawn(command, [...npmArgs, 'dev:inner', '--', ...args], {
    stdio: 'inherit',
  });
  dev.on('exit', (devCode) => {
    envWatcher.close();
    process.exit(devCode ?? 1);
  });
});

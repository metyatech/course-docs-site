import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFiles = [
  '.env',
  '.env.local',
  '.env.course',
  '.env.course.local',
];

const fileExists = async (targetPath) => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const backupFile = async (targetPath) => {
  if (!(await fileExists(targetPath))) {
    return null;
  }
  return fs.readFile(targetPath, 'utf8');
};

const restoreFile = async (targetPath, contentsOrNull) => {
  if (contentsOrNull === null) {
    await fs.rm(targetPath, { force: true });
    return;
  }
  await fs.writeFile(targetPath, contentsOrNull, 'utf8');
};

const runNodeScript = (scriptPath, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        COURSE_DOCS_SITE_DEV_INNER: 'stub',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });

test(
  'sync and dev fail fast when COURSE_CONTENT_SOURCE is omitted',
  { timeout: 60_000 },
  async (t) => {
    const backups = new Map();
    for (const filename of envFiles) {
      const targetPath = path.join(projectRoot, filename);
      backups.set(targetPath, await backupFile(targetPath));
      await fs.rm(targetPath, { force: true });
    }

    const originalCourseContentSource = process.env.COURSE_CONTENT_SOURCE;
    delete process.env.COURSE_CONTENT_SOURCE;

    t.after(async () => {
      for (const [targetPath, contents] of backups.entries()) {
        await restoreFile(targetPath, contents);
      }

      if (typeof originalCourseContentSource === 'string') {
        process.env.COURSE_CONTENT_SOURCE = originalCourseContentSource;
      } else {
        delete process.env.COURSE_CONTENT_SOURCE;
      }
    });

    const expectedMessage = 'COURSE_CONTENT_SOURCE is required.';

    const syncResult = await runNodeScript('scripts/sync-course-content.mjs');
    assert.notEqual(syncResult.code, 0);
    assert.match(`${syncResult.stdout}\n${syncResult.stderr}`, new RegExp(expectedMessage));

    const devResult = await runNodeScript('scripts/run-dev.mjs', ['--port', '3060']);
    assert.notEqual(devResult.code, 0);
    assert.match(`${devResult.stdout}\n${devResult.stderr}`, new RegExp(expectedMessage));
  }
);

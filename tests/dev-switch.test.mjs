import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envCourseLocalPath = path.join(projectRoot, '.env.course.local');
const envCoursePath = path.join(projectRoot, '.env.course');

const fileExists = async (p) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const backupFile = async (p) => {
  if (!(await fileExists(p))) {
    return null;
  }
  return fs.readFile(p, 'utf8');
};

const restoreFile = async (p, contentsOrNull) => {
  if (contentsOrNull === null) {
    await fs.rm(p, { force: true });
    return;
  }
  await fs.writeFile(p, contentsOrNull, 'utf8');
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate free port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchText = async (url) => {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  return { status: res.status, text };
};

const tryFetchText = async (url) => {
  try {
    return await fetchText(url);
  } catch {
    return null;
  }
};

const waitFor = async (fn, { timeoutMs, intervalMs, onTimeoutMessage }) => {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    if (now - startedAt > timeoutMs) {
      throw new Error(onTimeoutMessage ?? 'Timed out');
    }
    // eslint-disable-next-line no-await-in-loop
    const result = await fn();
    if (result) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
};

const writeCourseRepo = async ({ rootDir, courseName, extraDocsFolder }) => {
  const siteConfig = `export const siteConfig = {
  logoText: ${JSON.stringify(courseName)},
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "dev-switch test fixture",
  faviconHref: "/img/favicon.ico",
} as const;
`;

  const rootMeta = `const meta = {
  "*": {
    type: "page",
    theme: {
      timestamp: false
    }
  },
  index: {
    display: "hidden"
  },
  docs: "Docs",
};

export default meta;
`;

  const docsMeta = `const meta = {
  intro: {},
  ${JSON.stringify(extraDocsFolder)}: ${JSON.stringify(courseName)},
};

export default meta;
`;

  const mdxCommon = `---
title: ${JSON.stringify(courseName)}
---

import { Admonition } from "@metyatech/course-docs-platform/mdx";

${courseName}
`;

  await fs.mkdir(path.join(rootDir, 'content', 'docs', 'intro'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'content', 'docs', extraDocsFolder), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'public', 'img'), { recursive: true });

  await fs.writeFile(path.join(rootDir, 'site.config.ts'), siteConfig, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', '_meta.ts'), rootMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'docs', '_meta.ts'), docsMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'docs', 'intro', 'index.mdx'), mdxCommon, 'utf8');
  await fs.writeFile(
    path.join(rootDir, 'content', 'docs', extraDocsFolder, 'index.mdx'),
    mdxCommon,
    'utf8'
  );
  await fs.writeFile(path.join(rootDir, 'public', 'img', 'favicon.ico'), '', 'utf8');
};

const killProcessTree = async (child) => {
  if (!child || child.killed) {
    return;
  }
  try {
    child.kill();
  } catch {
    // ignore
  }

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
  await Promise.race([new Promise((resolve) => child.on('exit', () => resolve())), sleep(5000)]);
};

const safeRm = async (targetPath) => {
  try {
    const st = await fs.lstat(targetPath);
    if (st.isSymbolicLink()) {
      await fs.unlink(targetPath);
      return;
    }
  } catch {
    // ignore
  }
  await fs.rm(targetPath, { recursive: true, force: true });
};

test(
  'dev server switches course content when env file changes',
  { timeout: 2 * 60_000 },
  async (t) => {
  const port = await getFreePort();

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'course-dev-switch-'));
  const courseA = path.join(tempRoot, 'course-a');
  const courseB = path.join(tempRoot, 'course-b');

  await writeCourseRepo({ rootDir: courseA, courseName: 'Course A', extraDocsFolder: 'a-only' });
  await writeCourseRepo({ rootDir: courseB, courseName: 'Course B', extraDocsFolder: 'b-only' });

  const envCourseBackup = await backupFile(envCoursePath);
  const envCourseLocalBackup = await backupFile(envCourseLocalPath);

  t.after(async () => {
    await restoreFile(envCourseLocalPath, envCourseLocalBackup);
    await restoreFile(envCoursePath, envCourseBackup);
    await safeRm(path.join(projectRoot, 'content'));
    await safeRm(path.join(projectRoot, 'public'));
    await fs.mkdir(path.join(projectRoot, 'content'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'public'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'content', '.keep'), '', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'public', '.keep'), '', 'utf8');
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  // Keep secrets in `.env.local`. For switching content, use `.env.course.local`.
  await fs.rm(envCoursePath, { force: true });
  await fs.writeFile(envCourseLocalPath, `COURSE_CONTENT_DIR=${JSON.stringify(courseA)}\n`, 'utf8');

  const dev = spawn(process.execPath, ['scripts/run-dev.mjs', '--port', String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      COURSE_DOCS_SITE_DEV_INNER: 'stub',
    },
    stdio: 'inherit',
  });

  t.after(async () => {
    await killProcessTree(dev);
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  await waitFor(
    async () => {
      const result = await tryFetchText(`${baseUrl}/docs/a-only/`);
      return result?.status === 200;
    },
    {
      timeoutMs: 30_000,
      intervalMs: 200,
      onTimeoutMessage: 'Server did not become ready with Course A content.',
    }
  );

  {
    const a = await fetchText(`${baseUrl}/docs/a-only/`);
    const b = await fetchText(`${baseUrl}/docs/b-only/`);
    assert.equal(a.status, 200);
    assert.equal(b.status, 404);
  }

  // Switch to Course B by writing .env.course.local.
  // This must trigger a restart + content resync.
  await fs.writeFile(envCourseLocalPath, `COURSE_CONTENT_DIR=${JSON.stringify(courseB)}\n`, 'utf8');

  await waitFor(
    async () => {
      const a = await tryFetchText(`${baseUrl}/docs/a-only/`);
      const b = await tryFetchText(`${baseUrl}/docs/b-only/`);
      if (!a || !b) {
        return false;
      }
      return a.status === 404 && b.status === 200;
    },
    {
      timeoutMs: 30_000,
      intervalMs: 200,
      onTimeoutMessage: 'Server did not switch to Course B content.',
    }
  );
});

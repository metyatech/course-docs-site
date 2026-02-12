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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (fn, { timeoutMs, intervalMs, onTimeoutMessage }) => {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
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

const fetchText = async (url) => {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  return { status: response.status, text };
};

const tryFetchText = async (url) => {
  try {
    return await fetchText(url);
  } catch {
    return null;
  }
};

const writeFixtureCourseRepo = async (rootDir) => {
  const siteConfig = `export const siteConfig = {
  logoText: "Image Regression",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "intro image regression fixture",
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
};

export default meta;
`;

  const introMdx = `---
title: Intro
---

![fixture image](./img/pixel.png)
`;

  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5YxR8AAAAASUVORK5CYII=';
  const tinyPng = Buffer.from(tinyPngBase64, 'base64');

  await fs.mkdir(path.join(rootDir, 'content', 'docs', 'intro', 'img'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'public', 'img'), { recursive: true });

  await fs.writeFile(path.join(rootDir, 'site.config.ts'), siteConfig, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', '_meta.ts'), rootMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'docs', '_meta.ts'), docsMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'docs', 'intro', 'index.mdx'), introMdx, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'docs', 'intro', 'img', 'pixel.png'), tinyPng);
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
  await Promise.race([new Promise((resolve) => child.on('exit', () => resolve())), sleep(10_000)]);
};

test(
  'docs intro markdown image resolves as docs asset path (not _next static media)',
  { timeout: 2 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'course-intro-image-'));
    const fixtureCourse = path.join(tempRoot, 'course');
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);

    const dev = spawn(process.execPath, ['scripts/run-dev.mjs', '--port', String(port)], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        COURSE_CONTENT_SOURCE: fixtureCourse,
      },
      stdio: 'inherit',
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const result = await tryFetchText(`${baseUrl}/docs/intro/`);
        return result?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: 'Server did not become ready for /docs/intro/.',
      }
    );

    const intro = await fetchText(`${baseUrl}/docs/intro/`);
    assert.equal(intro.status, 200);

    const imageTagMatch = intro.text.match(/<img[^>]*alt="fixture image"[^>]*>/i);
    assert.ok(imageTagMatch, 'Could not find markdown image in /docs/intro/ HTML.');
    const srcMatch = imageTagMatch[0].match(/\ssrc="([^"]+)"/i);
    assert.ok(srcMatch, 'Could not read image src attribute.');
    const src = srcMatch[1];
    assert.ok(
      !src.startsWith('/_next/static/media/'),
      `Expected markdown image src to avoid _next/static/media, got: ${src}`
    );

    const imageUrl = new URL(src, `${baseUrl}/docs/intro/`).toString();
    const imageResponse = await fetch(imageUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(imageResponse.status, 200);
  }
);

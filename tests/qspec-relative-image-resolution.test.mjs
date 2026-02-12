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
  logoText: "QSpec Image Regression",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "qspec image resolution fixture",
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
  exams: "Exams",
};

export default meta;
`;

  const examsMeta = `const meta = {
  "2025": "2025",
};

export default meta;
`;

  const yearMeta = `const meta = {
  "2semester": "2semester",
};

export default meta;
`;

  const semesterMeta = `const meta = {
  "2final-exam": "2final-exam",
};

export default meta;
`;

  const examMeta = `const meta = {
  preparation: "Preparation",
};

export default meta;
`;

  const preparationMeta = `const meta = {
  index: {
    title: "Preparation",
  },
};

export default meta;
`;

  const preparationIndexMdx = `---
title: Preparation
---

import Q1 from './questions/q1.qspec.md';

<Q1 />
`;

  const questionSpec = `# 問題1

## Type

descriptive

## Prompt

![qspec image](../img/pixel.gif)

## Explanation

done
`;

  const tinyGifBase64 = 'R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=';
  const tinyGif = Buffer.from(tinyGifBase64, 'base64');

  await fs.mkdir(
    path.join(
      rootDir,
      'content',
      'exams',
      '2025',
      '2semester',
      '2final-exam',
      'preparation',
      'questions',
    ),
    { recursive: true },
  );
  await fs.mkdir(
    path.join(rootDir, 'content', 'exams', '2025', '2semester', '2final-exam', 'preparation', 'img'),
    { recursive: true },
  );
  await fs.mkdir(path.join(rootDir, 'public', 'img'), { recursive: true });

  await fs.writeFile(path.join(rootDir, 'site.config.ts'), siteConfig, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', '_meta.ts'), rootMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'exams', '_meta.ts'), examsMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'exams', '2025', '_meta.ts'), yearMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'exams', '2025', '2semester', '_meta.ts'), semesterMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'exams', '2025', '2semester', '2final-exam', '_meta.ts'), examMeta, 'utf8');
  await fs.writeFile(
    path.join(rootDir, 'content', 'exams', '2025', '2semester', '2final-exam', 'preparation', '_meta.ts'),
    preparationMeta,
    'utf8',
  );
  await fs.writeFile(
    path.join(rootDir, 'content', 'exams', '2025', '2semester', '2final-exam', 'preparation', 'index.mdx'),
    preparationIndexMdx,
    'utf8',
  );
  await fs.writeFile(
    path.join(
      rootDir,
      'content',
      'exams',
      '2025',
      '2semester',
      '2final-exam',
      'preparation',
      'questions',
      'q1.qspec.md',
    ),
    questionSpec,
    'utf8',
  );
  await fs.writeFile(
    path.join(rootDir, 'content', 'exams', '2025', '2semester', '2final-exam', 'preparation', 'img', 'pixel.gif'),
    tinyGif,
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
  await Promise.race([new Promise((resolve) => child.on('exit', () => resolve())), sleep(10_000)]);
};

test(
  'qspec markdown image resolves relative path from qspec directory',
  { timeout: 2 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'course-qspec-image-'));
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
        const result = await tryFetchText(
          `${baseUrl}/exams/2025/2semester/2final-exam/preparation/`,
        );
        return result?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage:
          'Server did not become ready for /exams/2025/2semester/2final-exam/preparation/.',
      },
    );

    const page = await fetchText(
      `${baseUrl}/exams/2025/2semester/2final-exam/preparation/`,
    );
    assert.equal(page.status, 200);

    const imageTagMatch = page.text.match(/<img[^>]*alt="qspec image"[^>]*>/i);
    assert.ok(imageTagMatch, 'Could not find qspec image in preparation page HTML.');
    const srcMatch = imageTagMatch[0].match(/\ssrc="([^"]+)"/i);
    assert.ok(srcMatch, 'Could not read qspec image src attribute.');
    const src = srcMatch[1];

    assert.equal(
      src,
      '/exams/2025/2semester/2final-exam/preparation/img/pixel.gif',
      `Expected qspec image src to resolve from question file directory, got: ${src}`,
    );

    const imageUrl = new URL(src, `${baseUrl}/exams/2025/2semester/2final-exam/preparation/`).toString();
    const imageResponse = await fetch(imageUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(imageResponse.status, 200);
  },
);

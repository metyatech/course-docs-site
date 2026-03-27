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
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(onTimeoutMessage ?? 'Timed out');
    }
    const result = await fn();
    if (result) {
      return;
    }
    await sleep(intervalMs);
  }
};

const fetchRedirect = async (url) => {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  return {
    status: response.status,
    location: response.headers.get('location'),
  };
};

const tryFetchRedirect = async (url) => {
  try {
    return await fetchRedirect(url);
  } catch {
    return null;
  }
};

const writeFixtureCourseRepo = async ({ rootDir, docsMeta, pages }) => {
  const siteConfig = `export const siteConfig = {
  title: "Redirect Fixture",
  logoText: "Redirect Fixture",
  githubRepo: "metyatech/redirect-fixture",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "root redirect regression fixture",
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

  const docsMetaSource = `const meta = ${JSON.stringify(docsMeta, null, 2)};

export default meta;
`;

  await fs.mkdir(path.join(rootDir, 'content', 'docs'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'public', 'img'), { recursive: true });

  await fs.writeFile(path.join(rootDir, 'site.config.ts'), siteConfig, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', '_meta.ts'), rootMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'docs', '_meta.ts'), docsMetaSource, 'utf8');
  await fs.writeFile(path.join(rootDir, 'public', 'img', 'favicon.ico'), '', 'utf8');

  for (const page of pages) {
    const pageDir = path.join(rootDir, 'content', 'docs', page.slug);
    await fs.mkdir(pageDir, { recursive: true });
    await fs.writeFile(
      path.join(pageDir, 'index.mdx'),
      `---\ntitle: ${JSON.stringify(page.title)}\n---\n\n${page.title}\n`,
      'utf8'
    );
  }
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
  'root redirect follows the first docs entry from the active content repo',
  { timeout: 2 * 60_000 },
  async (t) => {
    const scenarios = [
      {
        name: 'intro-first',
        docsMeta: { intro: {}, basics: 'Basics' },
        pages: [
          { slug: 'intro', title: 'Intro' },
          { slug: 'basics', title: 'Basics' },
        ],
        expectedLocation: '/docs/intro',
      },
      {
        name: 'overview-first',
        docsMeta: { '01-overview': 'Overview', basics: 'Basics' },
        pages: [
          { slug: '01-overview', title: 'Overview' },
          { slug: 'basics', title: 'Basics' },
        ],
        expectedLocation: '/docs/01-overview',
      },
    ];

    for (const scenario of scenarios) {
      const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), `course-root-redirect-${scenario.name}-`)
      );
      const fixtureCourse = path.join(tempRoot, 'course');
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      await writeFixtureCourseRepo({
        rootDir: fixtureCourse,
        docsMeta: scenario.docsMeta,
        pages: scenario.pages,
      });

      const dev = spawn(process.execPath, ['scripts/run-dev.mjs', '--port', String(port)], {
        cwd: projectRoot,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: '1',
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
        stdio: 'inherit',
      });

      await t.test(scenario.name, async () => {
        await waitFor(
          async () => {
            const redirectResult = await tryFetchRedirect(`${baseUrl}/`);
            return redirectResult?.status === 307;
          },
          {
            timeoutMs: 60_000,
            intervalMs: 500,
            onTimeoutMessage: `Server did not become ready for ${scenario.name}.`,
          }
        );

        const root = await fetchRedirect(`${baseUrl}/`);
        assert.equal(root.status, 307);
        assert.equal(root.location, scenario.expectedLocation);
      });

      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
);

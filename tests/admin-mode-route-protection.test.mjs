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

const fetchResponse = async (url, init) => {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location'),
    setCookie: response.headers.get('set-cookie'),
  };
};

const tryFetchResponse = async (url, init) => {
  try {
    return await fetchResponse(url, init);
  } catch {
    return null;
  }
};

const assertRedirectToIntro = (actualLocation) => {
  assert.ok(
    actualLocation === '/docs/intro' || actualLocation === '/docs/intro/',
    `Expected redirect to /docs/intro or /docs/intro/, got: ${actualLocation}`,
  );
};

const writeFixtureCourseRepo = async (rootDir) => {
  const siteConfig = `export const siteConfig = {
  title: "Admin Fixture",
  logoText: "Admin Fixture",
  githubRepo: "metyatech/admin-fixture",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "admin mode fixture",
  faviconHref: "/img/favicon.ico",
  adminMode: {
    publicFallbackPath: "/docs/intro",
    protectedLinks: [
      { href: "/docs/teacher-guide", label: "教員ガイド" },
      { href: "/docs/setup-and-troubleshooting", label: "セットアップ・トラブル対応" }
    ]
  }
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
  "teacher-guide": {
    display: "hidden"
  },
  "setup-and-troubleshooting": {
    display: "hidden"
  }
};

export default meta;
`;

  await fs.mkdir(path.join(rootDir, 'content', 'docs', 'intro'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'content', 'docs', 'teacher-guide'), { recursive: true });
  await fs.mkdir(
    path.join(rootDir, 'content', 'docs', 'setup-and-troubleshooting'),
    { recursive: true },
  );
  await fs.mkdir(path.join(rootDir, 'public', 'img'), { recursive: true });

  await fs.writeFile(path.join(rootDir, 'site.config.ts'), siteConfig, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', '_meta.ts'), rootMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'docs', '_meta.ts'), docsMeta, 'utf8');
  await fs.writeFile(
    path.join(rootDir, 'content', 'docs', 'intro', 'index.mdx'),
    '---\ntitle: Intro\n---\n\nPublic intro page.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(rootDir, 'content', 'docs', 'teacher-guide', 'index.mdx'),
    '---\ntitle: Teacher Guide\n---\n\nTeacher Guide\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(rootDir, 'content', 'docs', 'setup-and-troubleshooting', 'index.mdx'),
    '---\ntitle: Setup\n---\n\nSetup page\n',
    'utf8',
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
  'admin-only docs stay hidden from public and open with admin mode enabled',
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'course-admin-mode-'));
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
        ADMIN_DELETE_TOKEN: 'teacher-secret',
      },
      stdio: 'inherit',
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const redirectResult = await tryFetchResponse(`${baseUrl}/`);
        return redirectResult?.status === 307;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: 'Server did not become ready for admin-mode route protection test.',
      },
    );

    const root = await fetchResponse(`${baseUrl}/`);
    assert.equal(root.status, 307);
    assertRedirectToIntro(root.location);

    await waitFor(
      async () => {
        const teacherGuideResult = await tryFetchResponse(`${baseUrl}/docs/teacher-guide/`);
        return teacherGuideResult?.status === 307;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: 'Public teacher guide route did not start redirecting.',
      },
    );

    const publicTeacherGuide = await fetchResponse(`${baseUrl}/docs/teacher-guide/`);
    assert.equal(publicTeacherGuide.status, 307);
    assertRedirectToIntro(publicTeacherGuide.location);

    await waitFor(
      async () => {
        const introResult = await tryFetchResponse(`${baseUrl}/docs/intro/`);
        return introResult?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: 'Public intro page did not become ready.',
      },
    );

    const publicIntro = await fetchResponse(`${baseUrl}/docs/intro/`);
    assert.equal(publicIntro.status, 200);
    assert.ok(
      !publicIntro.text.includes('/docs/teacher-guide'),
      'Public intro page should not expose teacher-guide links.',
    );

    const enableAdmin = await fetchResponse(`${baseUrl}/api/admin/mode/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token: 'teacher-secret' }),
    });
    assert.equal(enableAdmin.status, 200);
    assert.ok(enableAdmin.setCookie, 'Expected admin mode API to set a cookie.');

    const cookieHeader = enableAdmin.setCookie.split(';', 1)[0];

    await waitFor(
      async () => {
        const adminTeacherGuide = await tryFetchResponse(`${baseUrl}/docs/teacher-guide/`, {
          headers: {
            cookie: cookieHeader,
          },
        });
        return adminTeacherGuide?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: 'Teacher guide did not open after enabling admin mode.',
      },
    );

    const adminTeacherGuide = await fetchResponse(`${baseUrl}/docs/teacher-guide/`, {
      headers: {
        cookie: cookieHeader,
      },
    });
    assert.equal(adminTeacherGuide.status, 200);
    assert.match(adminTeacherGuide.text, /Teacher Guide/);

    const disableAdmin = await fetchResponse(`${baseUrl}/api/admin/mode/`, {
      method: 'DELETE',
      headers: {
        cookie: cookieHeader,
      },
    });
    assert.equal(disableAdmin.status, 200);

    const teacherGuideAfterDisable = await fetchResponse(`${baseUrl}/docs/teacher-guide/`);
    assert.equal(teacherGuideAfterDisable.status, 307);
    assertRedirectToIntro(teacherGuideAfterDisable.location);
  },
);

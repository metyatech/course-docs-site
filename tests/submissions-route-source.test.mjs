import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const runSync = (env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/sync-course-content.mjs'], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });

const fileExists = async (targetPath) => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const writeCourseFixture = async (rootDir) => {
  const siteConfig = `export const siteConfig = {
  logoText: "fixture",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "submissions route test fixture",
  faviconHref: "/img/favicon.ico",
} as const;
`;

  const rootMeta = `const meta = {
  docs: "Docs",
  submissions: "Submissions",
};

export default meta;
`;

  const submissions = `---
title: "Submissions"
layout: full
toc: false
sidebar: false
---

# Submissions
`;

  await fs.mkdir(path.join(rootDir, 'content', 'submissions'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'public', 'img'), { recursive: true });

  await fs.writeFile(path.join(rootDir, 'site.config.ts'), siteConfig, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', '_meta.ts'), rootMeta, 'utf8');
  await fs.writeFile(path.join(rootDir, 'content', 'submissions', 'index.mdx'), submissions, 'utf8');
  await fs.writeFile(path.join(rootDir, 'public', 'img', 'favicon.ico'), '', 'utf8');
};

test('submissions route uses MDX page settings', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'submissions-route-test-'));
  const courseFixtureDir = path.join(tempRoot, 'course');

  await writeCourseFixture(courseFixtureDir);

  t.after(async () => {
    await fs.rm(path.join(projectRoot, 'content'), { recursive: true, force: true });
    await fs.rm(path.join(projectRoot, 'public'), { recursive: true, force: true });
    await fs.mkdir(path.join(projectRoot, 'content'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'public'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'content', '.keep'), '', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'public', '.keep'), '', 'utf8');
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const syncExitCode = await runSync({ COURSE_CONTENT_SOURCE: courseFixtureDir });
  assert.equal(syncExitCode, 0);

  const submissionsAppRoutePath = path.join(projectRoot, 'src', 'app', 'submissions', 'page.tsx');
  const submissionsMdxPath = path.join(projectRoot, 'content', 'submissions', 'index.mdx');

  assert.equal(
    await fileExists(submissionsAppRoutePath),
    false,
    'Do not add src/app/submissions/page.tsx because it bypasses MDX theme settings.'
  );

  const mdx = await fs.readFile(submissionsMdxPath, 'utf8');
  assert.match(mdx, /layout:\s*full/);
  assert.match(mdx, /toc:\s*false/);
  assert.match(mdx, /sidebar:\s*false/);
});

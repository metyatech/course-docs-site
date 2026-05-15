import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncScriptPath = path.join(projectRoot, "scripts/sync-course-content.mjs");

const writeCourseRepo = async ({ rootDir, courseName, introBody }) => {
  const siteConfig = `export const siteConfig = {\n  logoText: ${JSON.stringify(
    courseName,
  )},\n  projectLink: "https://example.invalid",\n  docsRepositoryBase: "https://example.invalid",\n  description: "sync-course-content fixture",\n  faviconHref: "/img/favicon.ico",\n} as const;\n`;

  const rootMeta = `const meta = {\n  "*": {\n    type: "page",\n    theme: {\n      timestamp: false\n    }\n  },\n  index: {\n    display: "hidden"\n  },\n  docs: "Docs",\n};\n\nexport default meta;\n`;

  const docsMeta = `const meta = {\n  intro: {},\n};\n\nexport default meta;\n`;

  const intro = `---\ntitle: ${JSON.stringify(courseName)}\n---\n\n${introBody}\n`;

  await fs.mkdir(path.join(rootDir, "content", "docs", "intro"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "public", "img"), { recursive: true });

  await fs.writeFile(path.join(rootDir, "site.config.ts"), siteConfig, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "_meta.ts"), rootMeta, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "docs", "_meta.ts"), docsMeta, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "docs", "intro", "index.mdx"), intro, "utf8");
  await fs.writeFile(path.join(rootDir, "public", "img", "favicon.ico"), "", "utf8");
};

const runSync = ({ env, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [syncScriptPath], {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

const isRealDirectory = async (targetPath) => {
  const st = await fs.lstat(targetPath);
  return st.isDirectory() && !st.isSymbolicLink();
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

test("local content sources are mirrored into real directories", { timeout: 60_000 }, async (t) => {
  const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-"));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-real-dir-"));
  const courseA = path.join(tempRoot, "course-a");

  await writeCourseRepo({
    rootDir: courseA,
    courseName: "Course A",
    introBody: "initial content",
  });

  t.after(async () => {
    await safeRm(fakeSiteRoot);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const exitCode = await runSync({ cwd: fakeSiteRoot, env: { COURSE_CONTENT_SOURCE: courseA } });
  assert.equal(exitCode, 0);
  assert.equal(await isRealDirectory(path.join(fakeSiteRoot, "content")), true);
  assert.equal(await isRealDirectory(path.join(fakeSiteRoot, "public")), true);
  assert.match(
    await fs.readFile(path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx"), "utf8"),
    /initial content/u,
  );
});

test(
  "sync replaces pre-existing external links with mirrored directories and prunes stale files",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-relink-"));
    const courseA = path.join(tempRoot, "course-a");

    await writeCourseRepo({
      rootDir: courseA,
      courseName: "Course A",
      introBody: "fresh content",
    });

    t.after(async () => {
      await safeRm(fakeSiteRoot);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    const targetLinkType = process.platform === "win32" ? "junction" : "dir";
    await safeRm(path.join(fakeSiteRoot, "content"));
    await safeRm(path.join(fakeSiteRoot, "public"));
    await fs.symlink(
      path.join(courseA, "content"),
      path.join(fakeSiteRoot, "content"),
      targetLinkType,
    );
    await fs.symlink(
      path.join(courseA, "public"),
      path.join(fakeSiteRoot, "public"),
      targetLinkType,
    );

    const exitCode = await runSync({ cwd: fakeSiteRoot, env: { COURSE_CONTENT_SOURCE: courseA } });
    assert.equal(exitCode, 0);
    assert.equal(await isRealDirectory(path.join(fakeSiteRoot, "content")), true);
    assert.equal(await isRealDirectory(path.join(fakeSiteRoot, "public")), true);

    const staleFilePath = path.join(fakeSiteRoot, "content", "docs", "stale.txt");
    await fs.writeFile(staleFilePath, "stale", "utf8");
    await fs.rm(path.join(courseA, "content", "docs", "intro", "index.mdx"), { force: true });
    await fs.mkdir(path.join(courseA, "content", "docs", "updated"), { recursive: true });
    await fs.writeFile(
      path.join(courseA, "content", "docs", "updated", "index.mdx"),
      '---\ntitle: "Updated"\n---\n\nupdated\n',
      "utf8",
    );

    const secondExitCode = await runSync({
      cwd: fakeSiteRoot,
      env: { COURSE_CONTENT_SOURCE: courseA },
    });
    assert.equal(secondExitCode, 0);
    await assert.rejects(fs.stat(staleFilePath));
    await assert.rejects(fs.stat(path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx")));
    assert.match(
      await fs.readFile(path.join(fakeSiteRoot, "content", "docs", "updated", "index.mdx"), "utf8"),
      /updated/u,
    );
  },
);

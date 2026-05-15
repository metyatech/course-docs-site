import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIsolatedNextDistDir, DEFAULT_NEXT_DIST_DIR } from "../scripts/next-dist-dir.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncScriptPath = path.join(projectRoot, "scripts/sync-course-content.mjs");

const fileExists = async (p) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const safeRm = async (p) => {
  await fs.rm(p, { recursive: true, force: true });
};

const writeCourseRepo = async ({ rootDir, courseName }) => {
  const siteConfig = `export const siteConfig = {\n  logoText: ${JSON.stringify(
    courseName,
  )},\n  projectLink: "https://example.invalid",\n  docsRepositoryBase: "https://example.invalid",\n  description: "sync-course-content test fixture",\n  faviconHref: "/img/favicon.ico",\n} as const;\n`;

  const rootMeta = `const meta = {\n  "*": {\n    type: "page",\n    theme: {\n      timestamp: false\n    }\n  },\n  index: {\n    display: "hidden"\n  },\n  docs: "Docs",\n};\n\nexport default meta;\n`;

  const docsMeta = `const meta = {\n  intro: {},\n};\n\nexport default meta;\n`;

  const intro = `---\ntitle: ${JSON.stringify(courseName)}\n---\n\n${courseName}\n`;

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

for (const distDir of [
  DEFAULT_NEXT_DIST_DIR,
  createIsolatedNextDistDir("sync-course-content-clears-next"),
]) {
  test(
    `sync clears ${distDir} when course source changes (prevents stale build artifacts)`,
    { timeout: 60_000 },
    async (t) => {
      const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-"));
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-next-"));
      const courseA = path.join(tempRoot, "course-a");
      const courseB = path.join(tempRoot, "course-b");
      const distDirPath = path.join(fakeSiteRoot, ...distDir.split("/"));

      await writeCourseRepo({ rootDir: courseA, courseName: "Course A" });
      await writeCourseRepo({ rootDir: courseB, courseName: "Course B" });

      t.after(async () => {
        await safeRm(fakeSiteRoot);
        await safeRm(tempRoot);
      });

      await fs.rm(path.join(fakeSiteRoot, ".course-content", "active-source.txt"), { force: true });

      await fs.mkdir(distDirPath, { recursive: true });
      await fs.writeFile(path.join(distDirPath, "keep-a.txt"), "a", "utf8");

      const aExit = await runSync({
        cwd: fakeSiteRoot,
        env: {
          COURSE_CONTENT_SOURCE: courseA,
          COURSE_DOCS_NEXT_DIST_DIR: distDir,
        },
      });
      assert.equal(aExit, 0);
      assert.equal(await fileExists(path.join(distDirPath, "keep-a.txt")), true);

      await fs.writeFile(path.join(distDirPath, "keep-b.txt"), "b", "utf8");

      const bExit = await runSync({
        cwd: fakeSiteRoot,
        env: {
          COURSE_CONTENT_SOURCE: courseB,
          COURSE_DOCS_NEXT_DIST_DIR: distDir,
        },
      });
      assert.equal(bExit, 0);
      assert.equal(await fileExists(distDirPath), false);
    },
  );
}

test("sync can preserve the active Next dist dir when run by the dev launcher", async (t) => {
  const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-"));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-next-"));
  const courseA = path.join(tempRoot, "course-a");
  const courseB = path.join(tempRoot, "course-b");
  const distDir = createIsolatedNextDistDir("sync-course-content-dev-preserve");
  const distDirPath = path.join(fakeSiteRoot, ...distDir.split("/"));

  await writeCourseRepo({ rootDir: courseA, courseName: "Course A" });
  await writeCourseRepo({ rootDir: courseB, courseName: "Course B" });

  t.after(async () => {
    await safeRm(fakeSiteRoot);
    await safeRm(tempRoot);
  });

  const aExit = await runSync({
    cwd: fakeSiteRoot,
    env: {
      COURSE_CONTENT_SOURCE: courseA,
      COURSE_DOCS_NEXT_DIST_DIR: distDir,
    },
  });
  assert.equal(aExit, 0);

  await fs.mkdir(distDirPath, { recursive: true });
  await fs.writeFile(path.join(distDirPath, "active-dev-cache.txt"), "active", "utf8");

  const bExit = await runSync({
    cwd: fakeSiteRoot,
    env: {
      COURSE_CONTENT_SOURCE: courseB,
      COURSE_DOCS_NEXT_DIST_DIR: distDir,
      COURSE_DOCS_SKIP_NEXT_DIST_CLEAR: "1",
    },
  });
  assert.equal(bExit, 0);
  assert.equal(await fileExists(path.join(distDirPath, "active-dev-cache.txt")), true);
});

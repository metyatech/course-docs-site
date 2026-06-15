import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIsolatedNextDistDir } from "../scripts/next-dist-dir.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncScriptPath = path.join(projectRoot, "scripts/sync-course-content.mjs");

const safeRm = async (targetPath) => {
  await fs.rm(targetPath, { recursive: true, force: true });
};

const fileExists = async (targetPath) => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
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

const writeFakeGit = async ({ binDir }) => {
  const fakeGitMjs = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_GIT_LOG_PATH;

if (logPath) {
  fs.appendFileSync(logPath, \`\${args.join(" ")}\\n\`);
}

const writeFixtureCourse = (targetDir) => {
  const siteConfig = \`export const siteConfig = {
  logoText: "Fake Remote Course",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "fake remote course fixture",
  faviconHref: "/img/favicon.ico",
} as const;
\`;

  const rootMeta = \`const meta = {
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
\`;

  const docsMeta = \`const meta = {
  intro: {},
};

export default meta;
\`;

  fs.mkdirSync(path.join(targetDir, "content", "docs", "intro"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "public", "img"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "site.config.ts"), siteConfig, "utf8");
  fs.writeFileSync(path.join(targetDir, "content", "_meta.ts"), rootMeta, "utf8");
  fs.writeFileSync(path.join(targetDir, "content", "docs", "_meta.ts"), docsMeta, "utf8");
  fs.writeFileSync(
    path.join(targetDir, "content", "docs", "intro", "index.mdx"),
    \`---
title: Fake Remote Course
---

\${process.env.FAKE_GIT_SHA}
\`,
    "utf8",
  );
  fs.writeFileSync(path.join(targetDir, "public", "img", "favicon.ico"), "", "utf8");
};

if (args[0] === "ls-remote") {
  const ref = args.at(-1);
  process.stdout.write(\`\${process.env.FAKE_GIT_SHA}\\trefs/heads/\${ref}\\n\`);
  process.exit(0);
}

// Mirrors the T10 pattern: normalizeOriginUrl runs unconditionally after
// clone and reads .git/config, so the fake must write a clean one.
const writeCleanGitConfig = (targetDir, canonicalUrl) => {
  const config = [
    '[remote "origin"]',
    "\turl = " + canonicalUrl,
    "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    "",
  ].join("\\n");
  fs.writeFileSync(path.join(targetDir, ".git", "config"), config, "utf8");
};

if (args[0] === "clone") {
  const targetDir = args.at(-1);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, ".git"), { recursive: true });
  const canonicalUrl = process.env.FAKE_GIT_CANONICAL_URL;
  if (typeof canonicalUrl === "string" && canonicalUrl.length > 0) {
    writeCleanGitConfig(targetDir, canonicalUrl);
  }
  writeFixtureCourse(targetDir);
  process.exit(0);
}

console.error(\`Unexpected fake git invocation: \${args.join(" ")}\`);
process.exit(1);
`;

  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, "git.mjs"), fakeGitMjs, "utf8");
};

test(
  "remote content sync reuses the clone only when the full active source id (repo+ref+SHA) is unchanged, and re-clones when the resolved head SHA changes for the same repo/ref",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-remote-"));
    const fakeBin = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "git.log");
    const distDir = createIsolatedNextDistDir("sync-course-content-remote-cache");
    const distDirPath = path.join(fakeSiteRoot, ...distDir.split("/"));
    const introPath = path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx");
    const activeSourcePath = path.join(fakeSiteRoot, ".course-content", "active-source.txt");

    const SHA_1 = "1111111111111111111111111111111111111111";
    const SHA_2 = "2222222222222222222222222222222222222222";
    const SHA_3 = "3333333333333333333333333333333333333333";

    await writeFakeGit({ binDir: fakeBin });

    t.after(async () => {
      await safeRm(fakeSiteRoot);
      await safeRm(tempRoot);
    });

    const baseEnv = {
      COURSE_CONTENT_SOURCE: "github:metyatech/fake-course#main",
      COURSE_DOCS_GIT_COMMAND: process.execPath,
      COURSE_DOCS_GIT_SCRIPT: path.join(fakeBin, "git.mjs"),
      COURSE_DOCS_NEXT_DIST_DIR: distDir,
      FAKE_GIT_LOG_PATH: logPath,
      FAKE_GIT_CANONICAL_URL: "https://github.com/metyatech/fake-course.git",
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
    };

    const countLog = async (prefix) => {
      const logLines = (await fs.readFile(logPath, "utf8"))
        .split(/\r?\n/u)
        .map((entry) => entry.trim())
        .filter(Boolean);
      return logLines.filter((entry) => entry.startsWith(prefix)).length;
    };

    await safeRm(path.join(fakeSiteRoot, ".course-content"));
    await safeRm(distDirPath);

    // ---- Case A: initial cold clone (repo/ref fake-course#main, SHA 1) ----
    const aExit = await runSync({
      cwd: fakeSiteRoot,
      env: { ...baseEnv, FAKE_GIT_SHA: SHA_1 },
    });
    assert.equal(aExit, 0, "case A: initial sync must succeed");
    assert.equal(await countLog("clone "), 1, "case A: exactly one clone so far");
    assert.equal(await countLog("ls-remote "), 1, "case A: exactly one ls-remote so far");
    assert.match(
      await fs.readFile(introPath, "utf8"),
      new RegExp(SHA_1),
      "case A: content body must carry SHA 1",
    );
    assert.equal(
      (await fs.readFile(activeSourcePath, "utf8")).trim(),
      `repo:metyatech/fake-course#main@${SHA_1}`,
      "case A: active-source.txt must record main@SHA1",
    );

    // ---- Case B: same repo/ref, same SHA -> reuse the clone ----
    await fs.mkdir(distDirPath, { recursive: true });
    await fs.writeFile(path.join(distDirPath, "keep-b.txt"), "keep", "utf8");
    const bExit = await runSync({
      cwd: fakeSiteRoot,
      env: { ...baseEnv, FAKE_GIT_SHA: SHA_1 },
    });
    assert.equal(bExit, 0, "case B: same-SHA sync must succeed");
    assert.equal(await countLog("clone "), 1, "case B: clone count must NOT increase (reuse)");
    assert.equal(await countLog("ls-remote "), 2, "case B: a second ls-remote ran");
    assert.match(
      await fs.readFile(introPath, "utf8"),
      new RegExp(SHA_1),
      "case B: content body stays SHA 1",
    );
    assert.equal(
      (await fs.readFile(activeSourcePath, "utf8")).trim(),
      `repo:metyatech/fake-course#main@${SHA_1}`,
      "case B: active-source.txt unchanged",
    );
    assert.equal(
      await fileExists(path.join(distDirPath, "keep-b.txt")),
      true,
      "case B: Next dist must NOT be cleared when the active source id is unchanged",
    );

    // ---- Case C: same repo/ref, NEW SHA -> re-clone + dist clear ----
    await fs.writeFile(path.join(distDirPath, "keep-c.txt"), "clear", "utf8");
    const cExit = await runSync({
      cwd: fakeSiteRoot,
      env: { ...baseEnv, FAKE_GIT_SHA: SHA_2 },
    });
    assert.equal(cExit, 0, "case C: SHA-update sync must succeed");
    assert.equal(await countLog("clone "), 2, "case C: clone count must increase by one (re-clone)");
    assert.equal(await countLog("ls-remote "), 3, "case C: a third ls-remote ran");
    assert.match(
      await fs.readFile(introPath, "utf8"),
      new RegExp(SHA_2),
      "case C: content body must update to SHA 2",
    );
    assert.doesNotMatch(
      await fs.readFile(introPath, "utf8"),
      new RegExp(SHA_1),
      "case C: stale SHA 1 content must be gone",
    );
    assert.equal(
      (await fs.readFile(activeSourcePath, "utf8")).trim(),
      `repo:metyatech/fake-course#main@${SHA_2}`,
      "case C: active-source.txt must advance to main@SHA2",
    );
    assert.equal(
      await fileExists(distDirPath),
      false,
      "case C: Next dist must be cleared when the active source id changes",
    );

    // ---- Case D: switch ref (feature-branch, SHA 3) -> re-clone ----
    const dExit = await runSync({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv,
        COURSE_CONTENT_SOURCE: "github:metyatech/fake-course#feature-branch",
        FAKE_GIT_SHA: SHA_3,
      },
    });
    assert.equal(dExit, 0, "case D: ref-switch sync must succeed");
    assert.equal(await countLog("clone "), 3, "case D: clone count must increase by one (re-clone)");
    assert.equal(await countLog("ls-remote "), 4, "case D: a fourth ls-remote ran");
    assert.match(
      await fs.readFile(introPath, "utf8"),
      new RegExp(SHA_3),
      "case D: content body must update to SHA 3",
    );
    assert.equal(
      (await fs.readFile(activeSourcePath, "utf8")).trim(),
      `repo:metyatech/fake-course#feature-branch@${SHA_3}`,
      "case D: active-source.txt must record feature-branch@SHA3",
    );
  },
);

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
  "remote content sync reuses the existing clone until the resolved ref changes",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-remote-"));
    const fakeBin = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "git.log");
    const distDir = createIsolatedNextDistDir("sync-course-content-remote-cache");
    const distDirPath = path.join(fakeSiteRoot, ...distDir.split("/"));

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

    await safeRm(path.join(fakeSiteRoot, ".course-content"));
    await safeRm(distDirPath);
    await fs.mkdir(distDirPath, { recursive: true });
    await fs.writeFile(path.join(distDirPath, "keep-first.txt"), "keep", "utf8");

    const firstExit = await runSync({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv,
        FAKE_GIT_SHA: "1111111111111111111111111111111111111111",
      },
    });
    assert.equal(firstExit, 0);
    assert.equal(await fileExists(path.join(distDirPath, "keep-first.txt")), true);

    await fs.writeFile(path.join(distDirPath, "keep-second.txt"), "keep", "utf8");

    const secondExit = await runSync({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv,
        FAKE_GIT_SHA: "1111111111111111111111111111111111111111",
      },
    });
    assert.equal(secondExit, 0);
    assert.equal(await fileExists(path.join(distDirPath, "keep-second.txt")), true);

    await fs.writeFile(path.join(distDirPath, "keep-third.txt"), "clear", "utf8");

    // The third run switches to a DIFFERENT REF (`feature-branch`).
    // The new design reuses the existing clone on the SAME (repo, ref)
    // even when the resolved head SHA changes (a `git clone --depth 1
    // --branch <ref>` pins content to the ref, so a SHA change for the
    // same ref does not require a re-clone). Switching the ref
    // exercises the cold-clone path: the script removes the existing
    // clone directory and re-clones for the new ref.
    const thirdExit = await runSync({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv,
        COURSE_CONTENT_SOURCE: "github:metyatech/fake-course#feature-branch",
        FAKE_GIT_SHA: "2222222222222222222222222222222222222222",
      },
    });
    assert.equal(thirdExit, 0);
    assert.equal(await fileExists(distDirPath), false);

    const logLines = (await fs.readFile(logPath, "utf8"))
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const cloneCount = logLines.filter((entry) => entry.startsWith("clone ")).length;
    const lsRemoteCount = logLines.filter((entry) => entry.startsWith("ls-remote ")).length;

    // Two clones total: one on the cold-start path (first run), one
    // on the ref-switch path (third run). The second run reuses the
    // existing clone because the (repo, ref) is unchanged.
    assert.equal(cloneCount, 2, `expected exactly 2 clone calls; got ${cloneCount}`);
    assert.equal(lsRemoteCount, 3, `expected exactly 3 ls-remote calls; got ${lsRemoteCount}`);
    assert.match(
      await fs.readFile(path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx"), "utf8"),
      /2222222222222222222222222222222222222222/,
    );
  },
);

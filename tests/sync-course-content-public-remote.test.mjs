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

// Public-path fake git. Mirrors the private-remote fake git but additionally
// records (in a single line) the presence/absence of the per-command auth
// context env vars, so the test can assert the public path skipped them.
const buildFakeGitSource = () => {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_GIT_LOG_PATH;

const append = (line) => {
  if (logPath) fs.appendFileSync(logPath, line + "\\n");
};

append("[argv] " + JSON.stringify(args));
append("[env] GIT_CONFIG_GLOBAL=" + JSON.stringify(process.env.GIT_CONFIG_GLOBAL ?? null));
append("[env] GIT_CONFIG_NOSYSTEM=" + JSON.stringify(process.env.GIT_CONFIG_NOSYSTEM ?? null));
append("[env] GIT_CONFIG_SYSTEM=" + JSON.stringify(process.env.GIT_CONFIG_SYSTEM ?? null));
append("[env] GIT_CONFIG_PARAMETERS=" + JSON.stringify(process.env.GIT_CONFIG_PARAMETERS ?? null));
append("[env] GH_TOKEN=" + JSON.stringify(process.env.GH_TOKEN ?? null));

const writeFixtureCourse = (targetDir) => {
  const siteConfig = \`export const siteConfig = {
  logoText: "Fake Public Course",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "fake public course fixture",
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
title: Fake Public Course
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

if (args[0] === "clone") {
  const targetDir = args.at(-1);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, ".git"), { recursive: true });
  writeFixtureCourse(targetDir);
  process.exit(0);
}

process.stderr.write("Unexpected fake git invocation: " + args.join(" ") + "\\n");
process.exit(1);
`;
};

const writeFakeGit = async ({ binDir }) => {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, "git.mjs"), buildFakeGitSource(), "utf8");
};

const parseEnvLines = (lines) => {
  const envLines = lines.filter((line) => line.startsWith("[env] "));
  return Object.fromEntries(
    envLines.map((line) => {
      const stripped = line.slice("[env] ".length);
      const eqIndex = stripped.indexOf("=");
      const key = stripped.slice(0, eqIndex);
      const rawValue = stripped.slice(eqIndex + 1);
      let decoded = rawValue;
      try {
        decoded = JSON.parse(rawValue);
      } catch {
        decoded = rawValue;
      }
      return [key, decoded];
    }),
  );
};

const parseArgvLines = (lines) => {
  const argvLines = lines.filter((line) => line.startsWith("[argv] "));
  return argvLines.map((line) => {
    const raw = line.slice("[argv] ".length);
    try {
      return JSON.parse(raw);
    } catch {
      return raw.split(" ");
    }
  });
};

test(
  "public remote sync still works after the auth-isolation changes and skips the per-command auth context",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-public-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-public-"));
    const fakeBin = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "git.log");
    const distDir = createIsolatedNextDistDir("sync-course-content-public-remote");

    await writeFakeGit({ binDir: fakeBin });

    t.after(async () => {
      await safeRm(fakeSiteRoot);
      await safeRm(tempRoot);
    });

    await safeRm(path.join(fakeSiteRoot, ...distDir.split("/")));

    const exitCode = await runSync({
      cwd: fakeSiteRoot,
      env: {
        COURSE_CONTENT_SOURCE: "github:metyatech/some-public-repo#main",
        // Intentionally NOT setting GH_TOKEN.
        COURSE_DOCS_GIT_COMMAND: process.execPath,
        COURSE_DOCS_GIT_SCRIPT: path.join(fakeBin, "git.mjs"),
        COURSE_DOCS_NEXT_DIST_DIR: distDir,
        FAKE_GIT_LOG_PATH: logPath,
        FAKE_GIT_SHA: "3333330000000000000000000000000000000000",
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
      },
    });
    assert.equal(exitCode, 0, "sync script should succeed for a public remote without GH_TOKEN");

    const lines = (await fs.readFile(logPath, "utf8")).split(/\r?\n/u);

    const argvRecords = parseArgvLines(lines);
    const commands = argvRecords.map((argv) => argv[0]);
    assert.ok(
      commands.includes("ls-remote"),
      `expected fake git to be invoked with ls-remote, got: ${commands.join(", ")}`,
    );
    assert.ok(
      commands.includes("clone"),
      `expected fake git to be invoked with clone, got: ${commands.join(", ")}`,
    );
    assert.ok(
      !commands.includes("-c"),
      `sync script must not prepend -c flags to argv (saw '-c'): ${commands.join(", ")}`,
    );

    const lsRemoteRecords = argvRecords.filter((argv) => argv[0] === "ls-remote");
    assert.equal(lsRemoteRecords.length, 1);
    assert.deepEqual(lsRemoteRecords[0], [
      "ls-remote",
      "https://github.com/metyatech/some-public-repo.git",
      "main",
    ]);

    // The fixture was mirrored: content/docs/intro/index.mdx exists and
    // contains the fake SHA.
    const introPath = path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx");
    const intro = await fs.readFile(introPath, "utf8");
    assert.match(intro, /3333330000000000000000000000000000000000/);

    // The public path must NOT install the per-command auth context. The
    // auth isolation is for the private-repo path; for public repos there
    // is no Authorization header to inject, so installing one would only
    // risk a spurious 401 from GitHub. Every env dump in the log (one per
    // fake-git invocation) must report GIT_CONFIG_PARAMETERS and GH_TOKEN
    // as null.
    const envMap = parseEnvLines(lines);
    for (const key of ["GIT_CONFIG_PARAMETERS", "GH_TOKEN"]) {
      assert.equal(
        envMap[key],
        null,
        `${key} must be unset on the public path; got ${JSON.stringify(envMap[key])}`,
      );
    }
  },
);

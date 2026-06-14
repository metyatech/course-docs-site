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

const distDirPathFrom = (root, distDir) => path.join(root, ...distDir.split("/"));

// Parse the env-dump lines emitted by the fake git. The fake git
// JSON-encodes each value so multi-line values like GIT_CONFIG_PARAMETERS
// can survive intact.
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

// Build a fake `git` (a Node script) that:
//   - logs argv to a log file (one line per invocation)
//   - for `ls-remote`, writes a fake SHA to stdout and exits 0
//   - for `clone`, writes the standard fixture and exits 0
//   - appends the env vars we care about to the log so the test can verify
//     the sync script installed the per-command git config isolation
//   - when `DUMP_GIT_CONFIG_GLOBAL_FILE` is "1", also appends the contents
//     of the file `GIT_CONFIG_GLOBAL` points at (so the test can prove the
//     seeded `~/.gitconfig` was not consulted)
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
  append("[env] GIT_DIR=" + JSON.stringify(process.env.GIT_DIR ?? null));
  append("[env] GIT_CONFIG_GLOBAL=" + JSON.stringify(process.env.GIT_CONFIG_GLOBAL ?? null));
  append("[env] GIT_CONFIG_NOSYSTEM=" + JSON.stringify(process.env.GIT_CONFIG_NOSYSTEM ?? null));
  append("[env] GIT_CONFIG_SYSTEM=" + JSON.stringify(process.env.GIT_CONFIG_SYSTEM ?? null));
  // GIT_CONFIG_PARAMETERS is logged too so a regression that re-introduces
  // it (e.g. on a future git version that accepts the newline-separated
  // form again) is observable in the log. The test does not assert on it.
  append("[env] GIT_CONFIG_PARAMETERS=" + JSON.stringify(process.env.GIT_CONFIG_PARAMETERS ?? null));
  // Intentionally do NOT log GH_TOKEN directly. The token is intentionally
  // embedded in the URL the sync script passes to git, so the argv log line
  // will contain the token. The test asserts the token appears only in URL
  // fields and nowhere else (no env vars, no error messages, no other URLs,
  // no basic-auth header values).
  if (process.env.GIT_CONFIG_GLOBAL) {
    let exists = "no";
    try {
      fs.statSync(process.env.GIT_CONFIG_GLOBAL);
      exists = "yes";
    } catch {
      exists = "no";
    }
    append("[env] GIT_CONFIG_GLOBAL_EXISTS_AT_INVOCATION=" + exists);
  }
  if (process.env.GIT_DIR) {
    let exists = "no";
    try {
      fs.statSync(process.env.GIT_DIR);
      exists = "yes";
    } catch {
      exists = "no";
    }
    append("[env] GIT_DIR_EXISTS_AT_INVOCATION=" + exists);
  }
  if (process.env.DUMP_GIT_CONFIG_GLOBAL_FILE === "1" && process.env.GIT_CONFIG_GLOBAL) {
    try {
      const contents = fs.readFileSync(process.env.GIT_CONFIG_GLOBAL, "utf8");
      append("[file] GIT_CONFIG_GLOBAL_CONTENTS_BEGIN");
      append(contents);
      append("[file] GIT_CONFIG_GLOBAL_CONTENTS_END");
    } catch (err) {
      append("[file] GIT_CONFIG_GLOBAL_READ_ERROR=" + (err && err.code ? err.code : "unknown"));
    }
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

const readLog = async (logPath) => {
  const text = await fs.readFile(logPath, "utf8");
  return text.split(/\r?\n/u);
};

test(
  "private remote sync installs per-command git config isolation and embeds the token only in URL fields",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-private-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-private-"));
    const fakeBin = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "git.log");
    const distDir = createIsolatedNextDistDir("sync-course-content-private-remote-auth");
    const distDirPath = path.join(fakeSiteRoot, ...distDir.split("/"));
    const fixtureToken = "fixture-private-token-NEVER-LEAK";

    await writeFakeGit({ binDir: fakeBin });

    t.after(async () => {
      await safeRm(fakeSiteRoot);
      await safeRm(tempRoot);
    });

    await safeRm(distDirPath);

    const exitCode = await runSync({
      cwd: fakeSiteRoot,
      env: {
        COURSE_CONTENT_SOURCE: "github:metyatech/teacher-profile-docs#main",
        GH_TOKEN: fixtureToken,
        COURSE_DOCS_GIT_COMMAND: process.execPath,
        COURSE_DOCS_GIT_SCRIPT: path.join(fakeBin, "git.mjs"),
        COURSE_DOCS_NEXT_DIST_DIR: distDir,
        FAKE_GIT_LOG_PATH: logPath,
        FAKE_GIT_SHA: "abcdef0000000000000000000000000000000000",
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
      },
    });
    assert.equal(exitCode, 0, "sync script should succeed for a private remote");

    const lines = await readLog(logPath);

    // argv contract: the sync script does NOT prepend `-c` flags. args[0] is
    // still "ls-remote" / "clone".
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

    // ls-remote URL is the authed form (the sync script URL-encodes the
    // token into the URL since `GIT_CONFIG_PARAMETERS` is rejected by
    // git 2.54+).
    const lsRemoteRecords = argvRecords.filter((argv) => argv[0] === "ls-remote");
    assert.equal(lsRemoteRecords.length, 1);
    const lsRemoteArgv = lsRemoteRecords[0];
    assert.deepEqual(lsRemoteArgv, [
      "ls-remote",
      `https://x-access-token:${fixtureToken}@github.com/metyatech/teacher-profile-docs.git`,
      "main",
    ]);
    // The clone URL is also authed.
    const cloneRecords = argvRecords.filter((argv) => argv[0] === "clone");
    assert.equal(cloneRecords.length, 1);
    const cloneArgv = cloneRecords[0];
    assert.ok(
      cloneArgv.some((arg) =>
        String(arg).includes(
          `x-access-token:${fixtureToken}@github.com/metyatech/teacher-profile-docs.git`,
        ),
      ),
      `clone argv must include the authed URL; got: ${cloneArgv.join(" ")}`,
    );

    // Auth context was installed and is visible to the spawned git.
    const envMap = parseEnvLines(lines);

    assert.equal(envMap.GIT_CONFIG_NOSYSTEM, "1", 'GIT_CONFIG_NOSYSTEM must be set to "1"');
    assert.ok(envMap.GIT_CONFIG_GLOBAL, "GIT_CONFIG_GLOBAL must point at a real file path");
    // The sync script disposes the temp config dir after the spawn returns,
    // so we cannot stat the file from the parent after the run. The fake
    // git records whether the file existed at invocation time.
    assert.equal(
      envMap.GIT_CONFIG_GLOBAL_EXISTS_AT_INVOCATION,
      "yes",
      "GIT_CONFIG_GLOBAL must point at a real file on disk at the time of invocation",
    );
    assert.ok(envMap.GIT_DIR, "GIT_DIR must be set when GH_TOKEN is present");
    assert.ok(
      path.isAbsolute(envMap.GIT_DIR),
      `GIT_DIR must be an absolute path; got ${envMap.GIT_DIR}`,
    );
    assert.notEqual(
      path.resolve(envMap.GIT_DIR),
      path.resolve(path.join(fakeSiteRoot, ".git")),
      "GIT_DIR must NOT point at the workspace's .git directory",
    );
    assert.equal(
      envMap.GIT_DIR_EXISTS_AT_INVOCATION,
      "yes",
      "GIT_DIR must point at a real directory on disk at the time of invocation",
    );

    // The token is now embedded in the URL (intentionally), so it WILL
    // appear in the logged argv. What matters is that the token does NOT
    // appear anywhere ELSE in the log: no env vars, no error messages, no
    // other URLs, no basic-auth header values. We assert the token appears
    // exactly twice (one URL field each for ls-remote and clone) and that
    // the total token count equals the URL count.
    const logBlob = lines.join("\n");
    const escapedToken = fixtureToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokenOccurrences = (logBlob.match(new RegExp(escapedToken, "g")) ?? []).length;
    const urlPattern = `x-access-token:${fixtureToken}@github.com`;
    const urlOccurrences = (
      logBlob.match(new RegExp(urlPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []
    ).length;
    assert.equal(
      urlOccurrences,
      2,
      `token should appear exactly twice (ls-remote URL + clone URL), got ${urlOccurrences}`,
    );
    assert.equal(
      tokenOccurrences,
      urlOccurrences,
      `token must not leak outside the expected URL fields (saw ${tokenOccurrences} total occurrences, ${urlOccurrences} in URLs)`,
    );

    // The fixture was mirrored.
    const introPath = path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx");
    const intro = await fs.readFile(introPath, "utf8");
    assert.match(intro, /abcdef0000000000000000000000000000000000/);
  },
);

test(
  "private remote sync still isolates GIT_CONFIG_GLOBAL when a stale ~/.gitconfig already defines the extraheader",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "course-sync-site-private-leftover-"),
    );
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-private-leftover-"));
    const fakeBin = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "git.log");
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-fake-home-"));
    const seededGitconfig = path.join(fakeHome, ".gitconfig");
    const distDir = createIsolatedNextDistDir("sync-course-content-private-remote-auth-leftover");
    const fixtureToken = "fixture-private-token-NEVER-LEAK-LEFTOVER";

    // Seed a "stale" gitconfig that would otherwise leak into the spawn
    // (this is the simulation of an `actions/checkout` extraheader leftover).
    await fs.writeFile(
      seededGitconfig,
      ['[http "https://github.com/"]', "\textraheader = AUTHORIZATION: basic BADBASIC", ""].join(
        "\n",
      ),
      "utf8",
    );

    await writeFakeGit({ binDir: fakeBin });

    t.after(async () => {
      await safeRm(fakeSiteRoot);
      await safeRm(tempRoot);
      await safeRm(fakeHome);
    });

    await safeRm(distDirPathFrom(fakeSiteRoot, distDir));

    const exitCode = await runSync({
      cwd: fakeSiteRoot,
      env: {
        COURSE_CONTENT_SOURCE: "github:metyatech/teacher-profile-docs#main",
        GH_TOKEN: fixtureToken,
        COURSE_DOCS_GIT_COMMAND: process.execPath,
        COURSE_DOCS_GIT_SCRIPT: path.join(fakeBin, "git.mjs"),
        COURSE_DOCS_NEXT_DIST_DIR: distDir,
        FAKE_GIT_LOG_PATH: logPath,
        FAKE_GIT_SHA: "1111110000000000000000000000000000000000",
        DUMP_GIT_CONFIG_GLOBAL_FILE: "1",
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        XDG_CONFIG_HOME: fakeHome,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
      },
    });
    assert.equal(exitCode, 0, "sync script should still succeed with a stale seeded gitconfig");

    const lines = await readLog(logPath);

    // Locate the GIT_CONFIG_GLOBAL path the sync script installed.
    const envMap = parseEnvLines(lines);

    assert.ok(envMap.GIT_CONFIG_GLOBAL, "GIT_CONFIG_GLOBAL must be set");
    const globalPath = envMap.GIT_CONFIG_GLOBAL;
    const globalPathNormalized = path.resolve(globalPath);
    const seededPathNormalized = path.resolve(seededGitconfig);
    assert.notEqual(
      globalPathNormalized,
      seededPathNormalized,
      "GIT_CONFIG_GLOBAL must NOT point at the seeded ~/.gitconfig",
    );

    // The file the sync script installed must be empty (no inherited
    // extraheader from a stale ~/.gitconfig) so the URL-embedded token
    // wins unambiguously.
    const begin = lines.indexOf("[file] GIT_CONFIG_GLOBAL_CONTENTS_BEGIN");
    const end = lines.indexOf("[file] GIT_CONFIG_GLOBAL_CONTENTS_END");
    assert.ok(
      begin !== -1 && end !== -1 && begin < end,
      "fake git must have dumped the global config file",
    );
    const contents = lines.slice(begin + 1, end).join("\n");
    assert.equal(
      contents.trim(),
      "",
      "GIT_CONFIG_GLOBAL file must be empty so the URL-embedded token is the only auth signal",
    );

    // GIT_DIR is set to a fresh, empty directory so the workspace's local
    // .git/config (and any includeIf: leftovers from actions/checkout) are
    // never consulted.
    assert.ok(envMap.GIT_DIR, "GIT_DIR must be set");
    assert.notEqual(
      path.resolve(envMap.GIT_DIR),
      path.resolve(path.join(fakeSiteRoot, ".git")),
      "GIT_DIR must NOT point at the workspace's .git directory",
    );

    // The token must appear in the log only in the URL fields (ls-remote
    // and clone), and the seeded `~/.gitconfig` content (BADBASIC) must
    // never appear in the log because the sync script bypasses it.
    const logBlob = lines.join("\n");
    const escapedToken = fixtureToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokenOccurrences = (logBlob.match(new RegExp(escapedToken, "g")) ?? []).length;
    const urlPattern = `x-access-token:${fixtureToken}@github.com`;
    const urlOccurrences = (
      logBlob.match(new RegExp(urlPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []
    ).length;
    assert.equal(
      urlOccurrences,
      2,
      `token should appear exactly twice (ls-remote URL + clone URL), got ${urlOccurrences}`,
    );
    assert.equal(
      tokenOccurrences,
      urlOccurrences,
      `token must not leak outside the expected URL fields (saw ${tokenOccurrences} total occurrences, ${urlOccurrences} in URLs)`,
    );
    assert.doesNotMatch(logBlob, /BADBASIC/);
  },
);

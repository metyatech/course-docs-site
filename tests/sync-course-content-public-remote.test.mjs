import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIsolatedNextDistDir } from "../scripts/next-dist-dir.mjs";
import { createIsolatedGitFixtureEnv } from "./git-fixture-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncScriptPath = path.join(projectRoot, "scripts/sync-course-content.mjs");

const safeRm = async (targetPath) => {
  await fs.rm(targetPath, { recursive: true, force: true });
};

const runSync = ({ env, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [syncScriptPath], {
      cwd,
      env: { ...createIsolatedGitFixtureEnv(), ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

// Public-path fake git. Mirrors the private-remote fake git log format
// so both tests assert the new contract symmetrically. The new design
// (T1) skips the per-command auth context on the public path: no
// GIT_CONFIG_COUNT / KEY_0 / VALUE_0 triple, no GIT_TERMINAL_PROMPT,
// no env scrubbing, and no tmpdir `cwd` override. The fake records
// the relevant env keys and the spawned process's working directory
// so the test can prove all of that is true.
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
append("[env] CWD=" + JSON.stringify(process.cwd()));
append("[env] GIT_CONFIG_COUNT=" + JSON.stringify(process.env.GIT_CONFIG_COUNT ?? null));
append("[env] GIT_CONFIG_KEY_0=" + JSON.stringify(process.env.GIT_CONFIG_KEY_0 ?? null));
append("[env] GIT_CONFIG_VALUE_0=" + JSON.stringify(process.env.GIT_CONFIG_VALUE_0 ?? null));
append("[env] GIT_TERMINAL_PROMPT=" + JSON.stringify(process.env.GIT_TERMINAL_PROMPT ?? null));
append("[env] GIT_DIR=" + JSON.stringify(process.env.GIT_DIR ?? null));
append("[env] GIT_WORK_TREE=" + JSON.stringify(process.env.GIT_WORK_TREE ?? null));
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

// The fake git writes a CLEAN .git/config (canonical origin URL, no
// credential) for the clone invocation. The production
// normalizeOriginUrl runs unconditionally on every clone path (new and
// reused) and rewrites any credentialed URL to the canonical form.
// The fake mirrors that post-clone state so the test's downstream
// "the canonical URL is the persisted origin URL" contract is
// observable; the real-git regression test in T6 covers the actual
// transformation. The FAKE_GIT_CANONICAL_URL indirection lets the
// test run against any owner/repo pair without rebuilding the fake.
const writeCleanGitConfig = (targetDir, canonicalUrl) => {
  const config = [
    '[remote "origin"]',
    "\\turl = " + canonicalUrl,
    "\\tfetch = +refs/heads/*:refs/remotes/origin/*",
    "",
  ].join("\\n");
  fs.writeFileSync(path.join(targetDir, ".git", "config"), config, "utf8");
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
  const canonicalUrl = process.env.FAKE_GIT_CANONICAL_URL;
  if (typeof canonicalUrl === "string" && canonicalUrl.length > 0) {
    writeCleanGitConfig(targetDir, canonicalUrl);
  }
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

const parseCwdLine = (lines) => {
  const cwdLine = lines.find((line) => line.startsWith("[env] CWD="));
  if (!cwdLine) return null;
  const raw = cwdLine.slice("[env] CWD=".length);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
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
  "public remote sync uses the canonical URL and runs the spawned git in the project root with no auth context installed",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-public-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-public-"));
    const fakeBin = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "git.log");
    const distDir = createIsolatedNextDistDir("sync-course-content-public-remote");
    const canonicalUrl = "https://github.com/metyatech/some-public-repo.git";

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
        // Intentionally NOT setting GH_TOKEN. The public path must
        // proceed without a token, so no auth context is installed
        // and no env scrubbing happens.
        COURSE_DOCS_GIT_COMMAND: process.execPath,
        COURSE_DOCS_GIT_SCRIPT: path.join(fakeBin, "git.mjs"),
        COURSE_DOCS_NEXT_DIST_DIR: distDir,
        FAKE_GIT_LOG_PATH: logPath,
        FAKE_GIT_SHA: "3333330000000000000000000000000000000000",
        FAKE_GIT_CANONICAL_URL: canonicalUrl,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
      },
    });
    assert.equal(exitCode, 0, "sync script should succeed for a public remote without GH_TOKEN");

    const lines = (await fs.readFile(logPath, "utf8")).split(/\r?\n/u);

    // argv contract: the sync script must NOT prepend `-c` flags, and
    // every argv record must use the canonical URL (no `x-access-token:`
    // userinfo, no `@github.com` userinfo, no token).
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
    assert.deepEqual(lsRemoteRecords[0], ["ls-remote", canonicalUrl, "main"]);

    const argvBlob = argvRecords.map((argv) => argv.join(" ")).join("\n");
    assert.equal(
      argvBlob.includes("x-access-token:"),
      false,
      "argv must not contain the x-access-token: prefix",
    );
    assert.equal(
      argvBlob.includes("@github.com"),
      false,
      "argv must not contain a github.com userinfo form",
    );

    // Env contract: the public path does not install an Authorization
    // header, so the spawned git's env must not carry the
    // GIT_CONFIG_COUNT / KEY_0 / VALUE_0 triple, must not disable
    // interactive prompts, and must not carry the override env vars
    // (those are only relevant to the private path). GH_TOKEN is
    // intentionally absent from the spawned env (this test never sets
    // it).
    const envMap = parseEnvLines(lines);
    for (const key of [
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_TERMINAL_PROMPT",
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GH_TOKEN",
    ]) {
      assert.equal(
        envMap[key],
        null,
        `${key} must be unset on the public path; got ${JSON.stringify(envMap[key])}`,
      );
    }

    // The spawned process's cwd must be the project root (the sync
    // script's own `process.cwd()`), not a fresh tmpdir. The sync
    // script is spawned with `cwd: fakeSiteRoot`, so its own
    // `process.cwd()` is fakeSiteRoot, and `runGit` falls back to
    // `process.cwd()` when no explicit cwd is passed on the public
    // path. We assert equality with the spawn cwd.
    const recordedCwd = parseCwdLine(lines);
    assert.ok(
      typeof recordedCwd === "string" && recordedCwd.length > 0,
      `fake git must record a CWD line; got ${JSON.stringify(recordedCwd)}`,
    );
    assert.equal(
      path.resolve(recordedCwd),
      path.resolve(fakeSiteRoot),
      `spawned cwd must equal the sync script's project root (the spawn cwd); got ${recordedCwd} vs ${fakeSiteRoot}`,
    );

    // The fixture was mirrored: content/docs/intro/index.mdx exists and
    // contains the fake SHA.
    const introPath = path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx");
    const intro = await fs.readFile(introPath, "utf8");
    assert.match(intro, /3333330000000000000000000000000000000000/);
  },
);

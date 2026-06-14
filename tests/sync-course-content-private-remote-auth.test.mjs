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

// Build a fake git (a Node script) that records the new auth-isolation
// contract to a log file:
//
//   - logs argv as a JSON array on one line (prefixed with "[argv] ")
//   - logs the canonical env-var keys (GIT_CONFIG_COUNT, KEY_0, VALUE_0,
//     TERMINAL_PROMPT, plus the scrubbed keys) as "[env] KEY=JSON.stringify(value)"
//   - logs the spawned process's working directory as "[env] CWD=JSON.stringify(value)"
//   - NEVER logs the literal b64 of GIT_CONFIG_VALUE_0; the value is
//     replaced by a length-only summary so the fixture token cannot be
//     captured into test artifacts the user might paste into a report
//   - for "ls-remote", writes a fake SHA to stdout and exits 0
//   - for "clone", writes the standard fixture course and a CLEAN
//     .git/config (canonical origin URL, no credential); this mirrors
//     what the production normalizeOriginUrl produces, so the test
//     "no credentialed origin URL in .git/config" assertion is observable
const buildFakeGitSource = () => {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_GIT_LOG_PATH;

const append = (line) => {
  if (logPath) fs.appendFileSync(logPath, line + "\\n");
};

const redactBase64HeaderValue = (value) => {
  if (typeof value !== "string") return value;
  if (!value.startsWith("AUTHORIZATION: basic ")) return value;
  const b64 = value.slice("AUTHORIZATION: basic ".length);
  return "AUTHORIZATION: basic [redacted-" + b64.length + "-b64-chars]";
};

  append("[argv] " + JSON.stringify(args));
  append("[env] CWD=" + JSON.stringify(process.cwd()));
  append("[env] GIT_CONFIG_COUNT=" + JSON.stringify(process.env.GIT_CONFIG_COUNT ?? null));
  append("[env] GIT_CONFIG_KEY_0=" + JSON.stringify(process.env.GIT_CONFIG_KEY_0 ?? null));
  append("[env] GIT_CONFIG_VALUE_0=" + JSON.stringify(redactBase64HeaderValue(process.env.GIT_CONFIG_VALUE_0 ?? null)));
  append("[env] GIT_TERMINAL_PROMPT=" + JSON.stringify(process.env.GIT_TERMINAL_PROMPT ?? null));
  // The new design scrubs these from the inherited parent env. The fake
  // records them only to assert they are absent.
  append("[env] GIT_DIR=" + JSON.stringify(process.env.GIT_DIR ?? null));
  append("[env] GIT_WORK_TREE=" + JSON.stringify(process.env.GIT_WORK_TREE ?? null));
  append("[env] GIT_CONFIG_PARAMETERS=" + JSON.stringify(process.env.GIT_CONFIG_PARAMETERS ?? null));
  append("[env] GIT_CONFIG_GLOBAL=" + JSON.stringify(process.env.GIT_CONFIG_GLOBAL ?? null));
  append("[env] GIT_CONFIG_SYSTEM=" + JSON.stringify(process.env.GIT_CONFIG_SYSTEM ?? null));
  append("[env] GIT_CONFIG_NOSYSTEM=" + JSON.stringify(process.env.GIT_CONFIG_NOSYSTEM ?? null));
  // Intentionally do NOT log GH_TOKEN directly. The token is delivered
  // to the spawned process only via the GIT_CONFIG_VALUE_0
  // extraheader Authorization header, and the b64 value is redacted
  // before the line is written. The test asserts the literal fixture
  // token never appears anywhere in the log.

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

// The canonical URL the sync script will pass on argv. The fake git
// writes a CLEAN .git/config with exactly this URL (mirroring what the
// production normalizeOriginUrl helper produces) so the test
// "no credentialed origin URL" assertion is observable. The
// process.env.FAKE_GIT_CANONICAL_URL indirection lets the test run
// against any owner/repo pair without rebuilding the fake.
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

const readLog = async (logPath) => {
  const text = await fs.readFile(logPath, "utf8");
  return text.split(/\r?\n/u);
};

const countOccurrences = (haystack, needle) => {
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (haystack.match(new RegExp(escaped, "g")) ?? []).length;
};

test(
  "private remote sync delivers the PAT via GIT_CONFIG extraheader in a fresh empty tmpdir, with no token in argv and no credentialed origin URL in the clone's .git/config",
  { timeout: 60_000 },
  async (t) => {
    const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-site-private-"));
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-private-"));
    const fakeBin = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "git.log");
    const distDir = createIsolatedNextDistDir("sync-course-content-private-remote-auth");
    const distDirPath = path.join(fakeSiteRoot, ...distDir.split("/"));
    const fixtureToken = "fixture-private-token-NEVER-LEAK";
    const canonicalUrl = "https://github.com/metyatech/teacher-profile-docs.git";

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
        FAKE_GIT_CANONICAL_URL: canonicalUrl,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
      },
    });
    assert.equal(exitCode, 0, "sync script should succeed for a private remote");

    const lines = await readLog(logPath);

    // argv contract: the sync script must NOT prepend `-c` flags. The
    // canonical URL appears verbatim in argv (no `x-access-token:` userinfo).
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

    // ls-remote argv: canonical URL only, no auth.
    const lsRemoteRecords = argvRecords.filter((argv) => argv[0] === "ls-remote");
    assert.equal(lsRemoteRecords.length, 1);
    const lsRemoteArgv = lsRemoteRecords[0];
    assert.deepEqual(lsRemoteArgv, ["ls-remote", canonicalUrl, "main"]);

    // clone argv: canonical URL only, no auth. The clone target is the
    // project-relative .course-content/repo path. Because the sync
    // script is spawned with `cwd: fakeSiteRoot`, the script's own
    // `process.cwd()` is fakeSiteRoot, so the relative target resolves
    // to `<fakeSiteRoot>/.course-content/repo`. The important point
    // is that the target is NOT the spawned git's tmpdir cwd.
    const cloneRecords = argvRecords.filter((argv) => argv[0] === "clone");
    assert.equal(cloneRecords.length, 1);
    const cloneArgv = cloneRecords[0];
    const expectedCloneDir = path.join(fakeSiteRoot, ".course-content", "repo");
    assert.deepEqual(cloneArgv, [
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
      canonicalUrl,
      expectedCloneDir,
    ]);

    // The token, the authed URL form, and the basic auth prefix must
    // never appear in argv. We assert the count is exactly 0 in the
    // argv lines specifically so a regression that smuggles the token
    // back into a command line fails the test before it reaches the
    // broader logBlob check.
    const argvBlob = argvRecords.map((argv) => argv.join(" ")).join("\n");
    assert.equal(
      countOccurrences(argvBlob, "x-access-token:"),
      0,
      "argv must not contain the x-access-token: prefix",
    );
    assert.equal(
      countOccurrences(argvBlob, fixtureToken),
      0,
      "argv must not contain the literal fixture token",
    );
    assert.equal(
      countOccurrences(argvBlob, "@github.com"),
      0,
      "argv must not contain a github.com userinfo form",
    );

    // Auth context was installed via GIT_CONFIG_COUNT / KEY_0 / VALUE_0,
    // and GIT_TERMINAL_PROMPT was disabled.
    const envMap = parseEnvLines(lines);

    assert.equal(envMap.GIT_CONFIG_COUNT, "1", 'GIT_CONFIG_COUNT must be set to "1"');
    assert.equal(
      envMap.GIT_CONFIG_KEY_0,
      "http.https://github.com/.extraheader",
      "GIT_CONFIG_KEY_0 must point at the http.https://github.com/.extraheader key",
    );
    // The fake git redacts the b64 credential value before logging, so
    // the line we see is "AUTHORIZATION: basic [redacted-N-b64-chars]".
    // We assert the structural prefix and a non-trivial length, but we
    // never assert on the literal b64 value (we do not have it, and we
    // do not want it in the test artifacts).
    assert.match(
      envMap.GIT_CONFIG_VALUE_0,
      /^AUTHORIZATION: basic \S+$/u,
      "GIT_CONFIG_VALUE_0 must start with the structural AUTHORIZATION: basic prefix and carry a non-empty credential value",
    );
    assert.ok(
      envMap.GIT_CONFIG_VALUE_0.length > "AUTHORIZATION: basic ".length + 5,
      "GIT_CONFIG_VALUE_0 must carry a non-trivial credential value",
    );
    assert.equal(
      envMap.GIT_TERMINAL_PROMPT,
      "0",
      'GIT_TERMINAL_PROMPT must be set to "0" to disable interactive prompts',
    );

    // The new design scrubs the override / credential env vars from the
    // inherited parent env. The fake records each as null when absent.
    for (const scrubbedKey of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
      "GIT_CONFIG_NOSYSTEM",
    ]) {
      assert.equal(
        envMap[scrubbedKey],
        null,
        `${scrubbedKey} must be scrubbed from the spawned process env (saw ${JSON.stringify(envMap[scrubbedKey])})`,
      );
    }

    // The spawned process's cwd is a fresh empty tmpdir (the
    // createIsolatedGitAuthContext cwd), not the project root, not
    // the fakeSiteRoot, and not the project root's .git. The sync
    // script disposes the tmpdir in its finally block before the
    // spawn returns, so we cannot stat the directory from the parent
    // after the run; we assert the structural shape (path lives
    // under os.tmpdir(), has the production prefix, and is not any
    // of the well-known workspace paths).
    const recordedCwd = parseCwdLine(lines);
    assert.ok(
      typeof recordedCwd === "string" && recordedCwd.length > 0,
      `fake git must record a CWD line; got ${JSON.stringify(recordedCwd)}`,
    );
    const projectRootFromCwd = process.cwd();
    const projectRootGit = path.resolve(projectRootFromCwd, ".git");
    const fakeSiteGit = path.resolve(fakeSiteRoot, ".git");
    assert.notEqual(
      path.resolve(recordedCwd),
      path.resolve(projectRootGit),
      "spawned cwd must not be the project root's .git directory",
    );
    assert.notEqual(
      path.resolve(recordedCwd),
      path.resolve(fakeSiteGit),
      "spawned cwd must not be the fakeSiteRoot's .git directory",
    );
    assert.notEqual(
      path.resolve(recordedCwd),
      path.resolve(fakeSiteRoot),
      "spawned cwd must not be the fakeSiteRoot itself",
    );
    assert.notEqual(
      path.resolve(recordedCwd),
      path.resolve(projectRootFromCwd),
      "spawned cwd must not be the project root",
    );
    // The cwd must live under os.tmpdir() and carry the production
    // "course-docs-git-cwd-" prefix, matching the mkdtempSync call
    // in createIsolatedGitAuthContext.
    const tmpRoot = path.resolve(os.tmpdir());
    assert.ok(
      path.resolve(recordedCwd).startsWith(tmpRoot + path.sep),
      `spawned cwd must live under os.tmpdir() (${tmpRoot}); got ${recordedCwd}`,
    );
    const cwdBasename = path.basename(recordedCwd);
    assert.ok(
      cwdBasename.startsWith("course-docs-git-cwd-"),
      `spawned cwd basename must start with "course-docs-git-cwd-"; got ${cwdBasename}`,
    );

    // The fixture was mirrored into the fakeSiteRoot (the sync
    // script's projectRoot = spawn cwd = fakeSiteRoot), confirming
    // the clone succeeded and the file mirroring pipeline ran. The
    // mirror target is <fakeSiteRoot>/content/, so the fixture ends
    // up at <fakeSiteRoot>/content/docs/intro/index.mdx.
    const introPath = path.join(fakeSiteRoot, "content", "docs", "intro", "index.mdx");
    const intro = await fs.readFile(introPath, "utf8");
    assert.match(intro, /abcdef0000000000000000000000000000000000/);

    // The clone's .git/config must not contain a credentialed origin
    // URL. The fake git writes a clean canonical config (mirroring the
    // production normalizeOriginUrl behavior); the test job is to
    // assert the production code path does not allow a credentialed
    // origin to leak through.
    const cloneConfigPath = path.join(expectedCloneDir, ".git", "config");
    const cloneConfig = await fs.readFile(cloneConfigPath, "utf8");
    assert.doesNotMatch(
      cloneConfig,
      /x-access-token:/iu,
      `clone .git/config must not contain x-access-token:; got: ${cloneConfig}`,
    );
    assert.doesNotMatch(
      cloneConfig,
      /:\/\/[^/\s@"]*@github\.com/iu,
      `clone .git/config must not contain a github.com userinfo origin; got: ${cloneConfig}`,
    );
    assert.match(
      cloneConfig,
      new RegExp(`url\\s*=\\s*${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"),
      `clone .git/config must contain the canonical origin URL ${canonicalUrl}; got: ${cloneConfig}`,
    );

    // Token safety across the entire log. The fixture token must not
    // appear anywhere in the log; the only place the credential could
    // be encoded is the GIT_CONFIG_VALUE_0 line, and the fake git
    // has already redacted that to a length-only summary.
    const logBlob = lines.join("\n");
    assert.equal(
      countOccurrences(logBlob, fixtureToken),
      0,
      `literal fixture token must not appear in the fake git log`,
    );
    assert.equal(
      countOccurrences(logBlob, "x-access-token:"),
      0,
      `x-access-token: prefix must not appear in the fake git log`,
    );
    assert.equal(
      countOccurrences(logBlob, "@github.com"),
      0,
      `github.com userinfo form must not appear in the fake git log`,
    );
  },
);

test(
  "private remote sync bypasses a stale ~/.gitconfig extraheader because the spawned git's cwd is an empty tmpdir (no includeIf.gitdir: can match)",
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
    const canonicalUrl = "https://github.com/metyatech/teacher-profile-docs.git";

    // Seed a "stale" gitconfig that would otherwise leak into the
    // spawn (this is the simulation of an `actions/checkout` extraheader
    // leftover). The literal value `BADBASIC` is recognizable in the
    // log so the test can prove the seeded file was never consulted.
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
        FAKE_GIT_CANONICAL_URL: canonicalUrl,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        XDG_CONFIG_HOME: fakeHome,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
      },
    });
    assert.equal(
      exitCode,
      0,
      "sync script should still succeed even when a stale seeded gitconfig is present in HOME",
    );

    const lines = await readLog(logPath);

    // Same argv contract as the basic test: canonical URL only, no
    // auth in argv, no `-c` flags.
    const argvRecords = parseArgvLines(lines);
    const commands = argvRecords.map((argv) => argv[0]);
    assert.ok(
      !commands.includes("-c"),
      `sync script must not prepend -c flags to argv (saw '-c'): ${commands.join(", ")}`,
    );
    const lsRemoteRecords = argvRecords.filter((argv) => argv[0] === "ls-remote");
    assert.equal(lsRemoteRecords.length, 1);
    assert.deepEqual(lsRemoteRecords[0], ["ls-remote", canonicalUrl, "main"]);

    const argvBlob = argvRecords.map((argv) => argv.join(" ")).join("\n");
    assert.equal(
      countOccurrences(argvBlob, "x-access-token:"),
      0,
      "argv must not contain the x-access-token: prefix",
    );
    assert.equal(
      countOccurrences(argvBlob, fixtureToken),
      0,
      "argv must not contain the literal fixture token",
    );
    assert.equal(
      countOccurrences(argvBlob, "@github.com"),
      0,
      "argv must not contain a github.com userinfo form",
    );

    // The auth-context env vars are still installed, and the override /
    // credential env vars are still scrubbed.
    const envMap = parseEnvLines(lines);
    assert.equal(envMap.GIT_CONFIG_COUNT, "1", 'GIT_CONFIG_COUNT must be set to "1"');
    assert.equal(
      envMap.GIT_CONFIG_KEY_0,
      "http.https://github.com/.extraheader",
      "GIT_CONFIG_KEY_0 must point at the http.https://github.com/.extraheader key",
    );
    assert.match(
      envMap.GIT_CONFIG_VALUE_0,
      /^AUTHORIZATION: basic \S+$/u,
      "GIT_CONFIG_VALUE_0 must start with the structural AUTHORIZATION: basic prefix and carry a non-empty credential value",
    );
    assert.equal(envMap.GIT_TERMINAL_PROMPT, "0", 'GIT_TERMINAL_PROMPT must be set to "0"');
    for (const scrubbedKey of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
      "GIT_CONFIG_NOSYSTEM",
    ]) {
      assert.equal(
        envMap[scrubbedKey],
        null,
        `${scrubbedKey} must be scrubbed from the spawned process env`,
      );
    }

    // The spawned process's cwd is still a fresh empty tmpdir. The
    // seeded ~/.gitconfig is irrelevant because the spawned git has
    // no .git/ in its cwd to match against, so no
    // includeIf.gitdir: rule (or any rule that consults the
    // surrounding repo's config) can fire. The sync script disposes
    // the tmpdir in its finally block, so we assert the structural
    // shape (under os.tmpdir(), with the production prefix) rather
    // than stat-ing the (now-deleted) directory.
    const recordedCwd = parseCwdLine(lines);
    assert.ok(
      typeof recordedCwd === "string" && recordedCwd.length > 0,
      `fake git must record a CWD line; got ${JSON.stringify(recordedCwd)}`,
    );
    const projectRootFromCwd = process.cwd();
    const projectRootGit = path.resolve(projectRootFromCwd, ".git");
    assert.notEqual(
      path.resolve(recordedCwd),
      path.resolve(projectRootGit),
      "spawned cwd must not be the project root's .git directory",
    );
    assert.notEqual(
      path.resolve(recordedCwd),
      path.resolve(fakeSiteRoot),
      "spawned cwd must not be the fakeSiteRoot",
    );
    const tmpRoot = path.resolve(os.tmpdir());
    assert.ok(
      path.resolve(recordedCwd).startsWith(tmpRoot + path.sep),
      `spawned cwd must live under os.tmpdir() (${tmpRoot}); got ${recordedCwd}`,
    );
    const cwdBasename = path.basename(recordedCwd);
    assert.ok(
      cwdBasename.startsWith("course-docs-git-cwd-"),
      `spawned cwd basename must start with "course-docs-git-cwd-"; got ${cwdBasename}`,
    );

    // The seeded gitconfig's payload (`BADBASIC`) must never appear in
    // the fake git log. If it did, that would mean the spawned git
    // process actually consulted the seeded `~/.gitconfig` (e.g. via
    // an `includeIf.gitdir:` rule that matched the spawned cwd's
    // `.git/`), which is the regression we are defending against.
    const logBlob = lines.join("\n");
    assert.doesNotMatch(
      logBlob,
      /BADBASIC/u,
      `seeded gitconfig payload BADBASIC must not appear in the fake git log; the spawned git's empty cwd is the only thing keeping it from leaking`,
    );

    // Token safety across the entire log: same contract as the basic
    // test, re-asserted here so this test stands on its own.
    assert.equal(
      countOccurrences(logBlob, fixtureToken),
      0,
      `literal fixture token must not appear in the fake git log`,
    );
    assert.equal(
      countOccurrences(logBlob, "x-access-token:"),
      0,
      `x-access-token: prefix must not appear in the fake git log`,
    );
    assert.equal(
      countOccurrences(logBlob, "@github.com"),
      0,
      `github.com userinfo form must not appear in the fake git log`,
    );
  },
);

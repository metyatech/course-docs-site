import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeOriginUrl } from "../scripts/git-origin-normalize.mjs";
import { createIsolatedGitFixtureEnv } from "./git-fixture-env.mjs";

const fixtureGitEnv = createIsolatedGitFixtureEnv();

// `git` is required for these tests. If the host has no real `git` binary
// on PATH (or it is not executable), we skip the entire file rather than
// fail. The skip uses `node --test`'s `t.skip` so the file is still
// reported as a pass.
const gitAvailable = (() => {
  const result = spawnSync("git", ["--version"], { encoding: "utf8", env: fixtureGitEnv });
  return result.status === 0;
})();

const FIXTURE_TOKEN = "fixture-redacted-token";
const CANONICAL_URL = "https://github.com/metyatech/teacher-profile-docs.git";
const CREDENTIALED_URL = `https://x-access-token:${FIXTURE_TOKEN}@github.com/metyatech/teacher-profile-docs.git`;
const BARE_TOKEN_URL = `https://${FIXTURE_TOKEN}@github.com/metyatech/teacher-profile-docs.git`;

// `git` subcommands used to set up the test fixture. `init -b main` was
// added in git 2.28; fall back to `init` + symbolic-ref when needed.
const initRepo = (cloneDir) => {
  let result = spawnSync("git", ["init", "--initial-branch=main", cloneDir], {
    encoding: "utf8", env: fixtureGitEnv,
  });
  if (result.status !== 0) {
    result = spawnSync("git", ["init", cloneDir], { encoding: "utf8", env: fixtureGitEnv });
    if (result.status !== 0) {
      throw new Error(
        `git init ${cloneDir} failed: ${result.stderr || result.stdout || "no stderr"}`,
      );
    }
    const refResult = spawnSync(
      "git",
      ["-C", cloneDir, "symbolic-ref", "HEAD", "refs/heads/main"],
      { encoding: "utf8", env: fixtureGitEnv },
    );
    if (refResult.status !== 0) {
      throw new Error(
        `git symbolic-ref HEAD failed: ${refResult.stderr || refResult.stdout || "no stderr"}`,
      );
    }
  }
  // Make `git` commits deterministic in this throwaway repo so any
  // failure path that reads config or refs does not depend on caller env.
  spawnSync("git", ["-C", cloneDir, "config", "user.email", "fixture@example.invalid"], {
    encoding: "utf8", env: fixtureGitEnv,
  });
  spawnSync("git", ["-C", cloneDir, "config", "user.name", "Fixture"], {
    encoding: "utf8", env: fixtureGitEnv,
  });
  spawnSync("git", ["-C", cloneDir, "config", "commit.gpgsign", "false"], {
    encoding: "utf8", env: fixtureGitEnv,
  });
};

const setRemoteOriginUrl = (cloneDir, url) => {
  const result = spawnSync("git", ["-C", cloneDir, "config", "remote.origin.url", url], {
    encoding: "utf8", env: fixtureGitEnv,
  });
  if (result.status !== 0) {
    throw new Error(
      `git config remote.origin.url failed: ${result.stderr || result.stdout || "no stderr"}`,
    );
  }
};

const getRemoteOriginUrl = (cloneDir) => {
  const result = spawnSync("git", ["-C", cloneDir, "remote", "get-url", "origin"], {
    encoding: "utf8", env: fixtureGitEnv,
  });
  if (result.status !== 0) {
    throw new Error(
      `git remote get-url origin failed: ${result.stderr || result.stdout || "no stderr"}`,
    );
  }
  return result.stdout.replace(/\r?\n$/u, "");
};

const removeRemoteOriginSection = (cloneDir) => {
  // Drop any existing remote section so tests can start from a known
  // empty baseline.
  const configPath = path.join(cloneDir, ".git", "config");
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === '[remote "origin"]');
  if (start === -1) return;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/u.test(lines[i])) {
      end = i;
      break;
    }
  }
  const stripped = lines.slice(0, start).concat(lines.slice(end));
  fs.writeFileSync(configPath, stripped.join("\n"));
};

const setConfigText = (cloneDir, text) => {
  const configPath = path.join(cloneDir, ".git", "config");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, text);
};

const readConfigText = (cloneDir) => {
  const configPath = path.join(cloneDir, ".git", "config");
  return fs.readFileSync(configPath, "utf8");
};

test("normalizeOriginUrl strips a credentialed origin URL via real git (x-access-token form)", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  setRemoteOriginUrl(cloneDir, CREDENTIALED_URL);

  // Pre-condition: real git currently reports the credentialed URL.
  const before = getRemoteOriginUrl(cloneDir);
  assert.equal(before, CREDENTIALED_URL);

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });

  // Post-condition: real git now reports the canonical URL.
  assert.equal(getRemoteOriginUrl(cloneDir), CANONICAL_URL);

  // Post-condition: the on-disk config no longer contains the credentialed
  // substring, the x-access-token: prefix, or any github.com userinfo
  // pattern.
  const text = readConfigText(cloneDir);
  assert.doesNotMatch(text, /x-access-token:/iu, "config must not contain x-access-token: prefix");
  assert.doesNotMatch(
    text,
    new RegExp(FIXTURE_TOKEN, "iu"),
    "config must not contain the fixture token",
  );
  assert.doesNotMatch(
    text,
    /:\/\/[^/\s@"]*@github\.com/iu,
    "config must not contain a github.com userinfo form",
  );
  assert.match(
    text,
    new RegExp(`url\\s*=\\s*${CANONICAL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"),
    `config must contain the canonical origin URL on a url = line; got:\n${text}`,
  );
});

test("normalizeOriginUrl is a no-op when the origin URL is already canonical", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  setRemoteOriginUrl(cloneDir, CANONICAL_URL);

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: false });

  assert.equal(getRemoteOriginUrl(cloneDir), CANONICAL_URL);
  const text = readConfigText(cloneDir);
  assert.doesNotMatch(text, /x-access-token:/iu, "config must not contain x-access-token: prefix");
  assert.doesNotMatch(
    text,
    new RegExp(FIXTURE_TOKEN, "iu"),
    "config must not contain the fixture token",
  );
});

test("normalizeOriginUrl strips a bare-token origin URL via real git", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  setRemoteOriginUrl(cloneDir, BARE_TOKEN_URL);

  const before = getRemoteOriginUrl(cloneDir);
  assert.equal(before, BARE_TOKEN_URL);

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });

  assert.equal(getRemoteOriginUrl(cloneDir), CANONICAL_URL);

  const text = readConfigText(cloneDir);
  assert.doesNotMatch(text, /x-access-token:/iu, "config must not contain x-access-token: prefix");
  assert.doesNotMatch(
    text,
    new RegExp(FIXTURE_TOKEN, "iu"),
    "config must not contain the fixture token",
  );
  assert.doesNotMatch(
    text,
    /:\/\/[^/\s@"]*@github\.com/iu,
    "config must not contain a github.com userinfo form",
  );
});

test('normalizeOriginUrl inserts the url = line when [remote "origin"] has no url = entry', async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  // Drop the [remote "origin"] section that `git config remote.origin.url`
  // would have created, then seed a clean section with only the fetch
  // line so the test exercises the "section exists, no url" branch.
  removeRemoteOriginSection(cloneDir);
  setConfigText(
    cloneDir,
    ['[remote "origin"]', "\tfetch = +refs/heads/*:refs/remotes/origin/*", ""].join("\n"),
  );

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });

  const text = readConfigText(cloneDir);
  assert.doesNotMatch(text, /x-access-token:/iu, "config must not contain x-access-token: prefix");
  assert.doesNotMatch(
    text,
    new RegExp(FIXTURE_TOKEN, "iu"),
    "config must not contain the fixture token",
  );
  // The canonical URL must appear on a `\turl =` line (single-tab indent,
  // matching the production helper's own writer).
  assert.match(
    text,
    new RegExp(`\\turl\\s*=\\s*${CANONICAL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"),
    `config must contain a tab-indented url = ${CANONICAL_URL} line; got:\n${text}`,
  );
  // The pre-existing fetch line must be preserved.
  assert.match(
    text,
    /\bfetch\s*=\s*\+refs\/heads\/\*:refs\/remotes\/origin\/\*/u,
    `config must preserve the fetch line; got:\n${text}`,
  );
});

test('normalizeOriginUrl appends a [remote "origin"] section when none exists', async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  removeRemoteOriginSection(cloneDir);

  // Sanity: real git refuses to read the URL because the section is
  // gone. We still call the helper, which must append the section.
  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });

  // After the repair, real git must report the canonical URL.
  assert.equal(getRemoteOriginUrl(cloneDir), CANONICAL_URL);

  const text = readConfigText(cloneDir);
  assert.doesNotMatch(text, /x-access-token:/iu, "config must not contain x-access-token: prefix");
  assert.doesNotMatch(
    text,
    new RegExp(FIXTURE_TOKEN, "iu"),
    "config must not contain the fixture token",
  );
  assert.match(
    text,
    /\[remote "origin"\]/u,
    `config must contain a [remote "origin"] section; got:\n${text}`,
  );
  assert.match(
    text,
    new RegExp(`url\\s*=\\s*${CANONICAL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"),
    `config must contain the canonical origin URL on a url = line; got:\n${text}`,
  );
});

test("normalizeOriginUrl throws (without leaking the token) when canonicalUrl itself is credentialed", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  setRemoteOriginUrl(cloneDir, CANONICAL_URL);

  const unsafeCanonical = "https://x-access-token:should-not-leak@github.com/x.git";
  let caught;
  try {
    normalizeOriginUrl(cloneDir, unsafeCanonical);
  } catch (error) {
    caught = error;
  }
  assert.ok(
    caught instanceof Error,
    "normalizeOriginUrl must throw on a credentialed canonicalUrl",
  );
  // The error message must not echo the offending token. The production
  // helper's message does include the substring "x-access-token" as a
  // structural example in its educational phrasing, which is a feature
  // (it tells the caller what kind of value is being rejected). The
  // leak guard is on the user-supplied value, not on the literal word.
  assert.doesNotMatch(
    caught.message,
    /should-not-leak/u,
    `error message must not echo the offending token; got: ${caught.message}`,
  );
  assert.doesNotMatch(
    caught.message,
    /@github\.com/iu,
    `error message must not echo the authed URL form; got: ${caught.message}`,
  );
});

test("normalizeOriginUrl throws when canonicalUrl contains a newline", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  setRemoteOriginUrl(cloneDir, CANONICAL_URL);

  let caught;
  try {
    normalizeOriginUrl(cloneDir, `${CANONICAL_URL}\nmalicious = x`);
  } catch (error) {
    caught = error;
  }
  assert.ok(
    caught instanceof Error,
    "normalizeOriginUrl must throw on a canonicalUrl with a newline",
  );
  assert.match(
    caught.message,
    /newline/iu,
    `error message must mention the newline guard; got: ${caught.message}`,
  );
});

test("normalizeOriginUrl rewrites an x-access-token: starting value and the new file contains no x-access-token prefix", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  // Defense-in-depth: the starting value carries the x-access-token:
  // prefix. The rewrite must succeed, and the post-rewrite file must
  // not contain x-access-token: anywhere.
  setRemoteOriginUrl(cloneDir, CREDENTIALED_URL);

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });
  assert.equal(getRemoteOriginUrl(cloneDir), CANONICAL_URL);

  const text = readConfigText(cloneDir);
  // The post-rewrite file content must not contain the x-access-token:
  // prefix anywhere (not in the new url = line, not in any leftover
  // comment, not anywhere).
  assert.doesNotMatch(
    text,
    /x-access-token:/iu,
    `post-rewrite config must not contain x-access-token: anywhere; got:\n${text}`,
  );
  // And the credentialed fixture token must be gone too.
  assert.doesNotMatch(
    text,
    new RegExp(FIXTURE_TOKEN, "iu"),
    `post-rewrite config must not contain the fixture token; got:\n${text}`,
  );
});

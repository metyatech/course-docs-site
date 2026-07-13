// Real-git regression tests for `normalizeOriginUrl`. The new
// implementation walks EVERY `[remote "origin"]` section and EVERY
// `url =` line in any origin section; this file exercises the
// transformations the previous implementation would have left behind.
//
// Every subtest creates a fresh `mkdtemp` clone dir, uses real `git
// init` + `git config remote.origin.url ...` (or direct file writes
// for the "no section" / "duplicate sections" cases) to seed the
// fixture, calls the production helper, then asserts via real `git
// -C <cloneDir> config --get-all remote.origin.url` that exactly one
// canonical value remains and the on-disk file does not contain the
// fixture token, the `x-access-token:` prefix, or any `@github.com`
// userinfo in any origin URL value.

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

const gitAvailable = (() => {
  const result = spawnSync("git", ["--version"], { encoding: "utf8", env: fixtureGitEnv });
  return result.status === 0;
})();

const FIXTURE_TOKEN = "fixture-redacted-origin-NEVER-LEAK";
const CANONICAL_URL = "https://github.com/metyatech/teacher-profile-docs.git";
const CREDENTIALED_URL = `https://x-access-token:${FIXTURE_TOKEN}@github.com/metyatech/teacher-profile-docs.git`;
const BARE_TOKEN_URL = `https://${FIXTURE_TOKEN}@github.com/metyatech/teacher-profile-docs.git`;
const CREDENTIALED_BACKUP_URL = `https://x-access-token:${FIXTURE_TOKEN}@github.com/metyatech/backup-repo.git`;
const BACKUP_CANONICAL_URL = "https://github.com/metyatech/backup-repo.git";

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

const getAllOriginUrls = (cloneDir) => {
  const result = spawnSync("git", ["-C", cloneDir, "config", "--get-all", "remote.origin.url"], {
    encoding: "utf8", env: fixtureGitEnv,
  });
  if (result.status !== 0) {
    return [];
  }
  return (result.stdout ?? "")
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

// All post-rewrite invariants the production helper must enforce.
// Used by every subtest to assert the final on-disk state.
const assertPostRewriteInvariants = (cloneDir, canonicalUrl) => {
  const text = readConfigText(cloneDir);
  // 1. The on-disk file does not contain the fixture token, the
  //    `x-access-token:` prefix, or any `@github.com` userinfo in
  //    any origin URL value. The new implementation walks every
  //    origin section and drops every `url =` line; the postcondition
  //    check inside the helper would have thrown if any of these
  //    strings remained.
  assert.doesNotMatch(
    text,
    new RegExp(FIXTURE_TOKEN, "iu"),
    `config must not contain the fixture token; got:\n${text}`,
  );
  assert.doesNotMatch(
    text,
    /x-access-token:/iu,
    `config must not contain the x-access-token: prefix; got:\n${text}`,
  );
  assert.doesNotMatch(
    text,
    /:\/\/[^/\s@"]*@github\.com/iu,
    `config must not contain any github.com userinfo; got:\n${text}`,
  );
  // 2. `git config --get-all remote.origin.url` (real git) reports
  //    exactly one value, and that value is the canonical URL.
  const originValues = getAllOriginUrls(cloneDir);
  assert.equal(
    originValues.length,
    1,
    `real git must report exactly one remote.origin.url value; got: ${JSON.stringify(originValues)}`,
  );
  assert.equal(
    originValues[0],
    canonicalUrl,
    `real git must report the canonical URL; got: ${originValues[0]}`,
  );
};

test('normalizeOriginUrl rewrites a clone with multiple url = lines in one [remote "origin"] section', async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-multi-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  // Seed a config with two `url =` lines inside one origin section.
  // The first is canonical, the second is credentialed. The new
  // implementation must drop BOTH and write exactly one canonical
  // `url =` line.
  setConfigText(
    cloneDir,
    [
      '[remote "origin"]',
      `\turl = ${CANONICAL_URL}`,
      `\turl = ${CREDENTIALED_URL}`,
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      "",
    ].join("\n"),
  );

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });
  assertPostRewriteInvariants(cloneDir, CANONICAL_URL);

  // The fetch = line must be preserved.
  const text = readConfigText(cloneDir);
  assert.match(
    text,
    /\bfetch\s*=\s*\+refs\/heads\/\*:refs\/remotes\/origin\/\*/u,
    `config must preserve the fetch = line; got:\n${text}`,
  );
});

test("normalizeOriginUrl rewrites a clone with credentialed URL first and canonical second", async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-credfirst-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  // Credentialed URL first (the dangerous one), canonical second.
  // The old implementation only rewrote the first matching `url =`
  // line; the new one drops every `url =` and writes exactly one
  // canonical entry.
  setConfigText(
    cloneDir,
    ['[remote "origin"]', `\turl = ${CREDENTIALED_URL}`, `\turl = ${CANONICAL_URL}`, ""].join("\n"),
  );

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });
  assertPostRewriteInvariants(cloneDir, CANONICAL_URL);
});

test('normalizeOriginUrl drops url = lines from a second [remote "origin"] section', async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-dupsec-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  // Two `[remote "origin"]` sections, each with a `url =` line.
  // `git config` would normally fail with "multiple remote.origin.url
  // values" on this file, but the new normalizeOriginUrl walks every
  // origin section and drops every `url =` line before writing the
  // canonical one. We assert that after the call, real git reports
  // exactly one canonical value (which means the file is now in a
  // shape `git config --get-all` accepts).
  setConfigText(
    cloneDir,
    [
      '[remote "origin"]',
      `\turl = ${CREDENTIALED_URL}`,
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      "",
      '[remote "origin"]',
      `\turl = ${CANONICAL_URL}`,
      "",
    ].join("\n"),
  );

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });
  assertPostRewriteInvariants(cloneDir, CANONICAL_URL);

  // The fetch = line in the FIRST origin section must be preserved
  // (it was in the section that was kept). We do not assert the
  // structural count of origin sections — the helper's contract is
  // "exactly one canonical `url =` line under any origin section" —
  // but we do assert the fetch = line is still present.
  const text = readConfigText(cloneDir);
  assert.match(
    text,
    /\bfetch\s*=\s*\+refs\/heads\/\*:refs\/remotes\/origin\/\*/u,
    `config must preserve the fetch = line; got:\n${text}`,
  );
});

test('normalizeOriginUrl inserts a url = line when [remote "origin"] has only a fetch = entry', async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-fetchonly-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  setConfigText(
    cloneDir,
    ['[remote "origin"]', "\tfetch = +refs/heads/*:refs/remotes/origin/*", ""].join("\n"),
  );

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });
  assertPostRewriteInvariants(cloneDir, CANONICAL_URL);

  const text = readConfigText(cloneDir);
  assert.match(
    text,
    /\bfetch\s*=\s*\+refs\/heads\/\*:refs\/remotes\/origin\/\*/u,
    `config must preserve the fetch = line; got:\n${text}`,
  );
});

test('normalizeOriginUrl appends a [remote "origin"] section when none exists', async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-empty-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  // No `[remote "origin"]` section at all.
  setConfigText(cloneDir, "");

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });
  assertPostRewriteInvariants(cloneDir, CANONICAL_URL);

  const text = readConfigText(cloneDir);
  assert.match(
    text,
    /\[remote "origin"\]/u,
    `config must contain a [remote "origin"] section after the call; got:\n${text}`,
  );
});

test('normalizeOriginUrl preserves a separate [remote "backup"] section', async (t) => {
  if (!gitAvailable) {
    t.skip("git binary not available on PATH");
    return;
  }
  const cloneDir = await fsp.mkdtemp(path.join(os.tmpdir(), "course-docs-origin-backup-"));
  t.after(async () => {
    await fsp.rm(cloneDir, { recursive: true, force: true });
  });

  initRepo(cloneDir);
  // Origin section is credentialed; backup section uses a different
  // NON-credentialed URL. The new implementation must rewrite ONLY
  // the origin section; the backup section must be preserved
  // verbatim. The backup section intentionally does NOT use a
  // credentialed URL because the helper's postcondition checks the
  // ENTIRE config file for `x-access-token:` and `@github.com`
  // userinfo — the helper's contract is "no credentialed URL may
  // remain anywhere in the file", and the postcondition is a
  // defense-in-depth backstop, not a section-scoped check.
  setConfigText(
    cloneDir,
    [
      '[remote "origin"]',
      `\turl = ${CREDENTIALED_URL}`,
      "",
      '[remote "backup"]',
      `\turl = ${BACKUP_CANONICAL_URL}`,
      "\tfetch = +refs/heads/*:refs/remotes/backup/*",
      "",
    ].join("\n"),
  );

  const result = normalizeOriginUrl(cloneDir, CANONICAL_URL);
  assert.deepEqual(result, { url: CANONICAL_URL, changed: true });
  assertPostRewriteInvariants(cloneDir, CANONICAL_URL);

  // The backup remote's `url =` line is still present and untouched.
  const text = readConfigText(cloneDir);
  assert.match(
    text,
    /\[remote "backup"\]/u,
    `config must preserve the [remote "backup"] section; got:\n${text}`,
  );
  assert.match(
    text,
    new RegExp(`url\\s*=\\s*${BACKUP_CANONICAL_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"),
    `config must still contain the backup remote's URL (untouched); got:\n${text}`,
  );
  // The fetch = line in the backup section is preserved verbatim.
  assert.match(
    text,
    /\bfetch\s*=\s*\+refs\/heads\/\*:refs\/remotes\/backup\/\*/u,
    `config must preserve the backup remote's fetch line; got:\n${text}`,
  );
});

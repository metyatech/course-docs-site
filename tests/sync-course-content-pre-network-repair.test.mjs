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

// A fake git that:
//   - records argv as "[argv] <json-array>"
//   - at ls-remote time, records whether the would-be clone directory
//     still exists ("[probe] cloneDirGitExistsAtLsRemote=<bool>") so the
//     test can prove the sync script deleted (or kept) the existing
//     clone BEFORE any network access
//   - ls-remote mode "ok" emits a fake SHA; mode "fail-128" writes a
//     credential-laden stderr and exits 128
//   - clone mode "ok" writes a fixture course + clean .git/config; mode
//     "fail-128" writes a credential-laden stderr and exits 128
//
// The fixture token is delivered to the spawned process only via the
// GIT_CONFIG_VALUE_0 extraheader; the fake never logs its raw value.
const FAKE_GIT_SOURCE = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_GIT_LOG_PATH;
const lsRemoteMode = process.env.FAKE_GIT_LS_REMOTE_MODE ?? "ok";
const cloneMode = process.env.FAKE_GIT_CLONE_MODE ?? "ok";
const fakeSha = process.env.FAKE_GIT_SHA ?? "abcdef0000000000000000000000000000000000";
const fixtureToken = process.env.FAKE_GIT_FIXTURE_TOKEN ?? "";
const canonicalUrl = process.env.FAKE_GIT_CANONICAL_URL ?? "";
const cloneDirProbe = process.env.FAKE_GIT_CLONE_DIR ?? "";

const append = (line) => {
  if (logPath) fs.appendFileSync(logPath, line + "\\n");
};

append("[argv] " + JSON.stringify(args));

const secretStderr =
  "fatal: unable to access 'https://x-access-token:" +
  fixtureToken +
  "@github.com/metyatech/teacher-profile-docs.git/': Authentication failed\\n";

if (args[0] === "ls-remote") {
  let exists = false;
  if (cloneDirProbe) {
    try {
      exists = fs.existsSync(path.join(cloneDirProbe, ".git"));
    } catch {
      exists = false;
    }
  }
  append("[probe] cloneDirGitExistsAtLsRemote=" + JSON.stringify(exists));
  if (lsRemoteMode === "fail-128") {
    process.stderr.write(secretStderr);
    process.exit(128);
  }
  process.stdout.write(fakeSha + "\\trefs/heads/" + args.at(-1) + "\\n");
  process.exit(0);
}

if (args[0] === "clone") {
  if (cloneMode === "fail-128") {
    process.stderr.write(secretStderr);
    process.exit(128);
  }
  const targetDir = args.at(-1);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, ".git"), { recursive: true });
  if (canonicalUrl) {
    const config = [
      '[remote "origin"]',
      "\\turl = " + canonicalUrl,
      "\\tfetch = +refs/heads/*:refs/remotes/origin/*",
      "",
    ].join("\\n");
    fs.writeFileSync(path.join(targetDir, ".git", "config"), config, "utf8");
  }
  fs.mkdirSync(path.join(targetDir, "content", "docs", "intro"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "public", "img"), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, "site.config.ts"),
    'export const siteConfig = { faviconHref: "/img/favicon.ico" } as const;\\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "content", "_meta.ts"),
    "const meta = { docs: 'Docs' };\\nexport default meta;\\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "content", "docs", "_meta.ts"),
    "const meta = { intro: {} };\\nexport default meta;\\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, "content", "docs", "intro", "index.mdx"),
    "---\\ntitle: Fake\\n---\\n\\n" + fakeSha + "\\n",
    "utf8",
  );
  fs.writeFileSync(path.join(targetDir, "public", "img", "favicon.ico"), "", "utf8");
  process.exit(0);
}

process.stderr.write("Unexpected fake git invocation: " + args.join(" ") + "\\n");
process.exit(1);
`;

const writeFakeGit = async ({ binDir }) => {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, "git.mjs"), FAKE_GIT_SOURCE, "utf8");
};

const runSyncCapturingParentStderr = ({ env, cwd }) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [syncScriptPath], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["inherit", "inherit", "pipe"],
    });
    const stderrChunks = [];
    if (child.stderr) {
      child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    }
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        parentStderr: Buffer.concat(stderrChunks.map((c) => Buffer.from(c))).toString("utf8"),
      });
    });
  });

const readLogLines = async (logPath) => {
  try {
    return (await fs.readFile(logPath, "utf8")).split(/\r?\n/u);
  } catch {
    return [];
  }
};

const parseArgvCommands = (lines) =>
  lines
    .filter((line) => line.startsWith("[argv] "))
    .map((line) => {
      try {
        return JSON.parse(line.slice("[argv] ".length));
      } catch {
        return [];
      }
    });

const probeValue = (lines) => {
  const probeLine = lines.find((line) => line.startsWith("[probe] cloneDirGitExistsAtLsRemote="));
  if (!probeLine) return null;
  try {
    return JSON.parse(probeLine.slice("[probe] cloneDirGitExistsAtLsRemote=".length));
  } catch {
    return null;
  }
};

const fixtureToken = "fixture-pre-network-token-NEVER-LEAK";
const canonicalUrl = "https://github.com/metyatech/teacher-profile-docs.git";
const credentialedUrl = `https://x-access-token:${fixtureToken}@github.com/metyatech/teacher-profile-docs.git`;

// Seed an existing clone whose `.git/config` carries a credentialed
// origin URL (the legacy leak this code path must repair / delete).
const seedExistingClone = async ({ siteRoot, previousSourceId }) => {
  const cloneDir = path.join(siteRoot, ".course-content", "repo");
  const gitDir = path.join(cloneDir, ".git");
  await fs.mkdir(gitDir, { recursive: true });
  const config = [
    '[remote "origin"]',
    `\turl = ${credentialedUrl}`,
    "\tfetch = +refs/heads/*:refs/remotes/origin/*",
    "",
  ].join("\n");
  await fs.writeFile(path.join(gitDir, "config"), config, "utf8");
  if (previousSourceId != null) {
    await fs.writeFile(
      path.join(siteRoot, ".course-content", "active-source.txt"),
      previousSourceId,
      "utf8",
    );
  }
  return { cloneDir, configPath: path.join(gitDir, "config") };
};

const baseEnv = ({ logPath, fakeBin, cloneDir }) => ({
  COURSE_CONTENT_SOURCE: "github:metyatech/teacher-profile-docs#main",
  GH_TOKEN: fixtureToken,
  COURSE_DOCS_GIT_COMMAND: process.execPath,
  COURSE_DOCS_GIT_SCRIPT: path.join(fakeBin, "git.mjs"),
  COURSE_DOCS_NEXT_DIST_DIR: ".next-test/sync-course-content-pre-network-repair",
  FAKE_GIT_LOG_PATH: logPath,
  FAKE_GIT_FIXTURE_TOKEN: fixtureToken,
  FAKE_GIT_CANONICAL_URL: canonicalUrl,
  FAKE_GIT_CLONE_DIR: cloneDir,
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
  Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
});

const harness = async (t, tag) => {
  const fakeSiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), `course-sync-prenet-site-${tag}-`));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `course-sync-prenet-${tag}-`));
  const fakeBin = path.join(tempRoot, "bin");
  const logPath = path.join(tempRoot, "git.log");
  await writeFakeGit({ binDir: fakeBin });
  t.after(async () => {
    await safeRm(fakeSiteRoot);
    await safeRm(tempRoot);
  });
  return { fakeSiteRoot, fakeBin, logPath };
};

test(
  "section 7: existing clone with matching active-source.txt has its credentialed origin repaired BEFORE ls-remote; ls-remote 128 fails closed, clone is never attempted, and the on-disk .git/config is canonical with no token",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, fakeBin, logPath } = await harness(t, "s7");
    const previousSourceId = `repo:metyatech/teacher-profile-docs#main@${"1".repeat(40)}`;
    const { cloneDir, configPath } = await seedExistingClone({
      siteRoot: fakeSiteRoot,
      previousSourceId,
    });

    // Precondition: the seeded config really does carry the credential.
    assert.match(await fs.readFile(configPath, "utf8"), /x-access-token:/u);

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv({ logPath, fakeBin, cloneDir }),
        FAKE_GIT_LS_REMOTE_MODE: "fail-128",
        FAKE_GIT_CLONE_MODE: "ok",
      },
    });

    assert.notEqual(result.code, 0, "sync must fail when ls-remote exits 128");

    const lines = await readLogLines(logPath);
    const commands = parseArgvCommands(lines).map((argv) => argv[0]);
    assert.ok(commands.includes("ls-remote"), "ls-remote must have been attempted");
    assert.ok(!commands.includes("clone"), "clone must NOT be attempted after ls-remote fails");

    // The clone dir was kept (same repo/ref) and present at ls-remote.
    assert.equal(
      probeValue(lines),
      true,
      "the matching clone must still exist at ls-remote time (repaired, not deleted)",
    );

    // The proof of pre-network repair: the on-disk .git/config is now
    // canonical even though the network step failed afterwards. Only a
    // normalizeOriginUrl call BEFORE ls-remote could have produced this.
    const finalConfig = await fs.readFile(configPath, "utf8");
    assert.doesNotMatch(finalConfig, /x-access-token:/u, "config must not contain x-access-token:");
    assert.doesNotMatch(
      finalConfig,
      /:\/\/[^/\s@"]*@github\.com/iu,
      "config must not contain a github.com userinfo origin",
    );
    assert.doesNotMatch(
      finalConfig,
      new RegExp(fixtureToken, "u"),
      "config must not contain the fixture token",
    );
    const canonicalCount = (
      finalConfig.match(new RegExp(`url = ${canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gu")) ?? []
    ).length;
    assert.equal(canonicalCount, 1, "config must contain exactly one canonical origin url line");

    // Parent stderr keeps the diagnostic but never echoes the secret.
    assert.match(result.parentStderr, /Authentication failed/iu);
    assert.match(result.parentStderr, /teacher-profile-docs/u);
    assert.doesNotMatch(result.parentStderr, new RegExp(fixtureToken, "u"));
    assert.doesNotMatch(result.parentStderr, /x-access-token:/u);
    assert.doesNotMatch(
      result.parentStderr,
      new RegExp(encodeURIComponent(fixtureToken), "u"),
      "parent stderr must not contain the percent-encoded token",
    );
    assert.doesNotMatch(
      result.parentStderr,
      new RegExp(Buffer.from(`x-access-token:${fixtureToken}`).toString("base64"), "u"),
      "parent stderr must not contain the base64 credential",
    );
  },
);

test(
  "section 8a: existing clone whose active-source.txt names a DIFFERENT repo is deleted BEFORE ls-remote, so its credentialed .git/config never survives a network failure",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, fakeBin, logPath } = await harness(t, "s8a");
    const previousSourceId = `repo:metyatech/some-other-repo#main@${"1".repeat(40)}`;
    const { cloneDir } = await seedExistingClone({
      siteRoot: fakeSiteRoot,
      previousSourceId,
    });

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv({ logPath, fakeBin, cloneDir }),
        FAKE_GIT_LS_REMOTE_MODE: "fail-128",
        FAKE_GIT_CLONE_MODE: "ok",
      },
    });

    assert.notEqual(result.code, 0, "sync must fail when ls-remote exits 128");

    const lines = await readLogLines(logPath);
    const commands = parseArgvCommands(lines).map((argv) => argv[0]);
    assert.ok(commands.includes("ls-remote"), "ls-remote must have been attempted");
    assert.ok(!commands.includes("clone"), "clone must NOT be attempted after ls-remote fails");

    // The different-source clone was removed BEFORE the network step.
    assert.equal(
      probeValue(lines),
      false,
      "the different-source clone must have been deleted before ls-remote",
    );
    assert.equal(
      await fileExists(path.join(cloneDir, ".git", "config")),
      false,
      "the credentialed .git/config must not survive the failed run",
    );
    assert.doesNotMatch(result.parentStderr, new RegExp(fixtureToken, "u"));
    assert.doesNotMatch(result.parentStderr, /x-access-token:/u);
  },
);

test(
  "section 8b: existing clone with NO active-source.txt (unknown state) is deleted BEFORE ls-remote",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, fakeBin, logPath } = await harness(t, "s8b");
    const { cloneDir } = await seedExistingClone({
      siteRoot: fakeSiteRoot,
      previousSourceId: null,
    });

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv({ logPath, fakeBin, cloneDir }),
        FAKE_GIT_LS_REMOTE_MODE: "fail-128",
        FAKE_GIT_CLONE_MODE: "ok",
      },
    });

    assert.notEqual(result.code, 0, "sync must fail when ls-remote exits 128");

    const lines = await readLogLines(logPath);
    const commands = parseArgvCommands(lines).map((argv) => argv[0]);
    assert.ok(!commands.includes("clone"), "clone must NOT be attempted after ls-remote fails");
    assert.equal(
      probeValue(lines),
      false,
      "the unknown-state clone must have been deleted before ls-remote",
    );
    assert.equal(
      await fileExists(path.join(cloneDir, ".git", "config")),
      false,
      "the credentialed .git/config must not survive the failed run",
    );
  },
);

test(
  "section 9: when ls-remote resolves a NEW head SHA but the re-clone fails, active-source.txt is NOT advanced to the new SHA",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, fakeBin, logPath } = await harness(t, "s9");
    const oldSourceId = `repo:metyatech/teacher-profile-docs#main@${"1".repeat(40)}`;
    const { cloneDir } = await seedExistingClone({
      siteRoot: fakeSiteRoot,
      previousSourceId: oldSourceId,
    });
    const activeSourcePath = path.join(fakeSiteRoot, ".course-content", "active-source.txt");

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...baseEnv({ logPath, fakeBin, cloneDir }),
        // ls-remote succeeds and reports a DIFFERENT head SHA (222...),
        // so the full active source id changes and a re-clone is
        // required. The re-clone then fails with exit 128.
        FAKE_GIT_SHA: "2".repeat(40),
        FAKE_GIT_LS_REMOTE_MODE: "ok",
        FAKE_GIT_CLONE_MODE: "fail-128",
      },
    });

    assert.notEqual(result.code, 0, "sync must fail when the re-clone exits 128");

    const lines = await readLogLines(logPath);
    const commands = parseArgvCommands(lines).map((argv) => argv[0]);
    assert.ok(commands.includes("ls-remote"), "ls-remote must have been attempted");
    assert.ok(commands.includes("clone"), "a re-clone must have been attempted for the new SHA");

    // The critical integrity assertion: the failed re-clone must NOT
    // advance the recorded SHA. The script writes active-source.txt
    // only after a successful clone, so the file must still hold the
    // old SHA (and definitely NOT the new 222... SHA).
    const recorded = (await fs.readFile(activeSourcePath, "utf8")).trim();
    assert.equal(recorded, oldSourceId, "active-source.txt must still hold the old SHA");
    assert.doesNotMatch(
      recorded,
      new RegExp("2".repeat(40), "u"),
      "active-source.txt must NOT record the new SHA after a failed re-clone",
    );
    assert.doesNotMatch(result.parentStderr, new RegExp(fixtureToken, "u"));
    assert.doesNotMatch(result.parentStderr, /x-access-token:/u);
  },
);

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

// The fake git is one Node script with per-invocation behaviour modes
// selected by env vars. The script always records argv + CWD + the
// scrubbed env keys + a redacted form of GIT_CONFIG_VALUE_0 to
// FAKE_GIT_LOG_PATH, so the test can grep those surfaces for the
// fixture token. The fake git is the simulated upstream — it is the
// ONLY place the fixture token is allowed to appear in raw form.
// Every "must not contain" assertion in the parent test applies to
// the parent process's captured surfaces (parent stderr, which for a
// thrown error includes Node's default uncaught-exception dump — that
// is the exception surface from the test's point of view) AND to the
// fake-git's log file (which represents what the parent process
// observed as the spawned git's argv and env).
const FAKE_GIT_SOURCE = `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_GIT_LOG_PATH;
const lsRemoteMode = process.env.FAKE_GIT_LS_REMOTE_MODE ?? "ok";
const cloneMode = process.env.FAKE_GIT_CLONE_MODE ?? "ok";
const fakeSha = process.env.FAKE_GIT_SHA ?? "deadbeef00000000000000000000000000000000";
const fixtureToken = process.env.FAKE_GIT_FIXTURE_TOKEN ?? "";
const canonicalUrl = process.env.FAKE_GIT_CANONICAL_URL ?? "";

const append = (line) => {
  if (logPath) fs.appendFileSync(logPath, line + "\\n");
};

const percentEncode = (s) => encodeURIComponent(s);
const base64Of = (s) => Buffer.from(s).toString("base64");

append("[argv] " + JSON.stringify(args));
append("[env] CWD=" + JSON.stringify(process.cwd()));
append("[env] GIT_CONFIG_COUNT=" + JSON.stringify(process.env.GIT_CONFIG_COUNT ?? null));
append("[env] GIT_CONFIG_KEY_0=" + JSON.stringify(process.env.GIT_CONFIG_KEY_0 ?? null));
// The fixture token is delivered to the spawned process only via
// GIT_CONFIG_VALUE_0 (and not via argv or the parent env). The fake
// git never logs the literal b64 value: it replaces the credential
// with a length-only summary, mirroring the T5 fake-git's contract.
const rawV0 = process.env.GIT_CONFIG_VALUE_0 ?? null;
if (typeof rawV0 === "string" && rawV0.startsWith("AUTHORIZATION: basic ")) {
  const b64 = rawV0.slice("AUTHORIZATION: basic ".length);
  append("[env] GIT_CONFIG_VALUE_0=" + JSON.stringify("AUTHORIZATION: basic [redacted-" + b64.length + "-b64-chars]"));
} else {
  append("[env] GIT_CONFIG_VALUE_0=" + JSON.stringify(rawV0));
}
append("[env] GIT_TERMINAL_PROMPT=" + JSON.stringify(process.env.GIT_TERMINAL_PROMPT ?? null));
append("[env] GH_TOKEN=" + JSON.stringify(process.env.GH_TOKEN ? "[set]" : null));
// Echo the FAKE_GIT_FIXTURE_TOKEN env var as a non-credential marker
// so the test can prove the fake git received it (it would, in a real
// git binary, end up baked into the GIT_CONFIG_VALUE_0 extraheader).
// The marker is "[set]" so no fixture token shape ever leaves the
// child process as plain text on this line.
append("[env] FAKE_GIT_FIXTURE_TOKEN=" + JSON.stringify(fixtureToken ? "[set]" : null));

// Build the secret-laden stderr once, so the test can assert all four
// shapes are present in the fake-git's stderr (proving the fake git
// really emitted them) but the parent sync script redacts them all
// from every captured surface.
const pctEnc = percentEncode(fixtureToken);
const b64 = base64Of("x-access-token:" + fixtureToken);
const secretStderrLines = [
  "fatal: unable to access 'https://x-access-token:" + fixtureToken + "@github.com/metyatech/teacher-profile-docs.git/': Authentication failed",
  "fatal: also saw https://" + pctEnc + "@github.com/metyatech/teacher-profile-docs.git",
  "fatal: server sent: authorization: basic " + b64,
  "Authentication failed for 'https://x-access-token:" + fixtureToken + "@github.com/metyatech/teacher-profile-docs.git/'",
];
const secretStderr = secretStderrLines.join("\\n") + "\\n";

if (args[0] === "ls-remote") {
  append("[mode] ls-remote=" + lsRemoteMode);
  if (lsRemoteMode === "fail-128-with-secrets") {
    // Write the secret-laden stderr to the fake-git's own stderr
    // (simulating a real git binary). The fake-git's LOG FILE
    // intentionally does NOT include the raw secret shapes — the
    // log file is a "captured surface" the parent test asserts on
    // for redaction, and the simulated stderr is the INPUT to the
    // redactor (the sync script reads it via result.stderr), not
    // a surface the redactor's output is measured against. The
    // plan is explicit: the fixture token WILL be written to the
    // fake-git's stderr as part of simulating a real git failure;
    // the assertion is that the redacted output (parent stderr /
    // exception / log argv / log env) does not contain the token.
    // The fake-git's own logger redacts env values
    // (GIT_CONFIG_VALUE_0 -> [redacted-N-b64-chars],
    // GH_TOKEN -> [set], FAKE_GIT_FIXTURE_TOKEN -> [set]) so the
    // env lines in the log are already redaction-safe.
    process.stderr.write(secretStderr);
    process.exit(128);
  }
  if (lsRemoteMode === "empty-0") {
    // Write nothing to stdout, exit 0 — the sync script must throw
    // "Unable to resolve remote ref ... from <canonicalUrl>".
    process.exit(0);
  }
  if (lsRemoteMode === "malformed-0") {
    // No SHA before the tab. The sync script's parser trims and
    // splits, so this malformed line is treated as the SHA token
    // "refs/heads/main" (no internal whitespace) and the script
    // proceeds to clone. The clone will succeed (fake git's "ok"
    // mode) and the post-clone required-path check will fire
    // "Missing required path in content repo: content (content)".
    // The test asserts the parent throws AND that no token shape
    // appears in any captured surface. The redaction contract is
    // what this scenario defends; the specific error message is
    // an implementation detail of the parser.
    process.stdout.write("\\trefs/heads/main\\n");
    process.exit(0);
  }
  // Default: ok — emit a valid SHA so the sync script proceeds to clone.
  process.stdout.write(fakeSha + "\\trefs/heads/" + args.at(-1) + "\\n");
  process.exit(0);
}

if (args[0] === "clone") {
  append("[mode] clone=" + cloneMode);
  if (cloneMode === "fail-128-with-secrets") {
    process.stderr.write(secretStderr);
    process.exit(128);
  }
  // Default: succeed and write a clean .git/config (canonical URL only).
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
  process.exit(0);
}

process.stderr.write("Unexpected fake git invocation: " + args.join(" ") + "\\n");
process.exit(1);
`;

// Helper: spawn the sync script as a child of THIS test (the "parent
// process"). We capture parent stderr (so the test can grep the
// redacted diagnostics the sync script writes via process.stderr.write
// before it throws, AND the Node.js default uncaught-exception dump
// that propagates the thrown error to the child's exit). The fake-
// git's log file is read separately after the spawn completes.
const runSyncCapturingParentStderr = ({ env, cwd }) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [syncScriptPath], {
      cwd,
      env: { ...process.env, ...env },
      // Mirror the production `run` helper: stdout inherited (so the
      // user / CI sees live progress), stderr piped so we can capture
      // the redacted diagnostics for the failure-redaction assertions.
      // For ls-remote failures the production `runCapture` helper
      // does NOT write to process.stderr — it only returns the error
      // — but Node's default uncaught-exception handler DOES write
      // the error to stderr before exiting with code 1, so the
      // captured parent stderr still contains the exception text.
      // For clone failures the production `run` helper writes the
      // redacted stderr to process.stderr before throwing, so the
      // captured parent stderr contains both the redacted diagnostics
      // AND the subsequent uncaught-exception dump.
      stdio: ["inherit", "inherit", "pipe"],
    });
    const stderrChunks = [];
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(chunk);
      });
    }
    let errorEvent = null;
    child.on("error", (err) => {
      errorEvent = err;
    });
    child.on("exit", (code) => {
      const blob = Buffer.concat(stderrChunks.map((c) => Buffer.from(c)));
      resolve({
        code: code ?? 1,
        parentStderrBlob: blob.toString("utf8"),
        errorEvent,
      });
    });
  });

// The six "must not contain" patterns. These are the leakage rules
// the plan enumerates; the parent test asserts every one of them
// against every captured surface.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Assert every "must not contain" rule against every captured surface.
// The captured surfaces are:
//   - the parent process's captured stderr (the redacted diagnostics
//     the sync script writes to process.stderr before throwing, plus
//     Node's default uncaught-exception dump that contains the error
//     text). This is the exception surface from the test's point of
//     view — the sync script throws inside the child, and Node's
//     default handler writes the error to the child's stderr.
//   - the fake-git's log file (what the parent process observed as
//     the spawned git's argv and env; this is the only surface where
//     the fixture token is allowed to appear in raw form, and the
//     assertion confirms that even there the token is redacted by
//     the fake-git's own logger or never appears in argv at all).
const assertNoLeaks = ({
  parentStderrBlob,
  fakeGitLog,
  argvLines,
  fixtureToken,
  percentEncodedToken,
  base64Token,
}) => {
  const surfaces = {
    "parent stderr (exception surface)": parentStderrBlob ?? "",
    "fake git log": fakeGitLog,
    "fake git argv": argvLines.join("\n"),
  };
  for (const value of Object.values(surfaces)) {
    assert.ok(
      typeof value === "string",
      "captured surface must be a string so negative assertions are well-defined",
    );
  }

  const negativePatterns = [
    {
      name: "literal fixture token",
      pattern: new RegExp(escapeRegExp(fixtureToken), "i"),
    },
    {
      name: "percent-encoded fixture token",
      pattern: new RegExp(escapeRegExp(percentEncodedToken), "i"),
    },
    { name: "x-access-token: prefix", pattern: /x-access-token:/iu },
    {
      name: "x-access-token:<token>@github.com URL",
      pattern: new RegExp("x-access-token:" + escapeRegExp(fixtureToken) + "@github\\.com", "iu"),
    },
    {
      // Matches `authorization: basic <b64>` with a non-trivial credential
      // value (8+ base64-ish chars). The redactor strips the value, so any
      // captured surface that still matches this pattern would mean a
      // regression.
      name: "Authorization: basic <b64> with credential value",
      pattern: /authorization:\s*basic\s+[A-Za-z0-9+/=._\-]{8,}/iu,
    },
    {
      // The base64 form is also a leakage vector. The redactor must
      // scrub it; the fake-git's log records a length-only summary for
      // GIT_CONFIG_VALUE_0 (not the literal b64), so the b64 should
      // never appear in any captured surface.
      name: "literal base64 credential",
      pattern: new RegExp(escapeRegExp(base64Token), "i"),
    },
  ];

  for (const [surfaceName, surfaceValue] of Object.entries(surfaces)) {
    for (const { name, pattern } of negativePatterns) {
      assert.doesNotMatch(
        surfaceValue,
        pattern,
        `${surfaceName} must not contain ${name}; got: ${surfaceValue}`,
      );
    }
  }
};

const readFakeGitLog = async (logPath) => {
  try {
    const text = await fs.readFile(logPath, "utf8");
    return text.split(/\r?\n/u);
  } catch {
    return [];
  }
};

const buildFixtureTokenData = () => {
  const fixtureToken = "fixture-private-redaction-token-NEVER-LEAK";
  const percentEncodedToken = encodeURIComponent(fixtureToken);
  const base64Token = Buffer.from(`x-access-token:${fixtureToken}`).toString("base64");
  return { fixtureToken, percentEncodedToken, base64Token };
};

const writeFakeGitScript = async ({ binDir }) => {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, "git.mjs"), FAKE_GIT_SOURCE, "utf8");
};

// Each scenario is a self-contained subtest that:
//   1. builds a fakeSiteRoot + tempRoot + fakeBin + logPath
//   2. writes the fake git
//   3. spawns the sync script with parent stderr piped to a blob
//   4. asserts the spawn failed (non-zero exit) and that every
//      captured surface (parent stderr / fake-git's log / fake-git's
//      argv) is free of the fixture token, the percent-encoded form,
//      the x-access-token: prefix, the authed @github.com URL form,
//      the Authorization: basic <b64> header value, and the base64
//      form of the credential.
const buildScenarioHarness = async (t, scenarioTag) => {
  const fakeSiteRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `course-sync-redact-site-${scenarioTag}-`),
  );
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `course-sync-redact-${scenarioTag}-`));
  const fakeBin = path.join(tempRoot, "bin");
  const logPath = path.join(tempRoot, "git.log");
  await writeFakeGitScript({ binDir: fakeBin });
  t.after(async () => {
    await safeRm(fakeSiteRoot);
    await safeRm(tempRoot);
  });
  return { fakeSiteRoot, tempRoot, fakeBin, logPath };
};

const buildBaseEnv = ({ logPath, fixtureToken, canonicalUrl, fakeBin }) => ({
  COURSE_CONTENT_SOURCE: "github:metyatech/teacher-profile-docs#main",
  GH_TOKEN: fixtureToken,
  COURSE_DOCS_GIT_COMMAND: process.execPath,
  COURSE_DOCS_GIT_SCRIPT: path.join(fakeBin, "git.mjs"),
  FAKE_GIT_LOG_PATH: logPath,
  FAKE_GIT_SHA: "abcdef0000000000000000000000000000000000",
  FAKE_GIT_FIXTURE_TOKEN: fixtureToken,
  FAKE_GIT_CANONICAL_URL: canonicalUrl,
  // Use a per-scope Next dist dir so concurrent runs do not collide.
  COURSE_DOCS_NEXT_DIST_DIR: ".next-test/sync-course-content-failure-redaction",
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
  Path: `${fakeBin}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ""}`,
});

test(
  "A. ls-remote exit 128 with secret-laden stderr: parent surfaces never echo token, x-access-token, percent-encoded, base64, or @github.com userinfo",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, tempRoot, fakeBin, logPath } = await buildScenarioHarness(t, "A");
    const { fixtureToken, percentEncodedToken, base64Token } = buildFixtureTokenData();
    const canonicalUrl = "https://github.com/metyatech/teacher-profile-docs.git";

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...buildBaseEnv({ logPath, fixtureToken, canonicalUrl, fakeBin }),
        FAKE_GIT_LS_REMOTE_MODE: "fail-128-with-secrets",
        FAKE_GIT_CLONE_MODE: "ok",
      },
    });

    // The sync script threw (a non-zero exit).
    assert.notEqual(result.code, 0, "sync script must exit non-zero when ls-remote fails");
    assert.equal(
      result.errorEvent,
      null,
      "spawn must not emit an error event for a non-zero exit (the sync script threw inside the child)",
    );

    // The fake git was actually invoked with ls-remote (we want the
    // assertion to apply to the surfaces that the parent process
    // observed, not a no-op spawn).
    const fakeGitLines = await readFakeGitLog(logPath);
    const argvLines = fakeGitLines.filter((line) => line.startsWith("[argv] "));
    const parsedArgvs = argvLines.map((line) => {
      const raw = line.slice("[argv] ".length);
      try {
        return JSON.parse(raw);
      } catch {
        return raw.split(" ");
      }
    });
    const commands = parsedArgvs.map((a) => a[0]);
    assert.ok(
      commands.includes("ls-remote"),
      `expected fake git to be invoked with ls-remote, got: ${commands.join(", ")}`,
    );
    // The clone was never attempted (ls-remote failed first), so the
    // fake-git's log file should NOT contain a clone argv line.
    assert.ok(
      !commands.includes("clone"),
      `clone must not be attempted when ls-remote fails; got: ${commands.join(", ")}`,
    );

    // The argv passed to git ls-remote is the canonical URL only
    // (already asserted in T5; re-checked here so the scenario's own
    // negative-asset suite is self-contained).
    const lsRemoteArgv = parsedArgvs.find((argv) => argv[0] === "ls-remote");
    assert.ok(lsRemoteArgv, "ls-remote argv must be present in the fake git log");
    assert.deepEqual(lsRemoteArgv, ["ls-remote", canonicalUrl, "main"]);

    // The fake git DID write the secret-laden stderr to its own
    // stderr (this is the simulated upstream). The parent process's
    // captured surfaces are: (1) the sync script's exception message
    // (which Node's default uncaught-exception handler writes to
    // parent stderr), and (2) the fake-git's log file.
    const fakeGitLog = fakeGitLines.join("\n");
    const parentStderrBlob = result.parentStderrBlob;

    // Positive witnesses: the redacted diagnostics must contain the
    // "Authentication failed" literal (the redactor keeps that
    // wording) and the canonical repository name. The parent stderr
    // blob contains both the production `runCapture` exception
    // (which carries the redacted stderr in its message) and Node's
    // default uncaught-exception dump (which also contains the
    // error). Both surfaces together MUST contain the "Authentication
    // failed" literal and the canonical repository name.
    assert.match(
      parentStderrBlob,
      /Authentication failed/iu,
      `parent stderr must mention 'Authentication failed' (the redactor keeps this literal); got: ${parentStderrBlob}`,
    );
    assert.match(
      parentStderrBlob,
      /teacher-profile-docs/,
      "parent stderr must mention the canonical repository name (the redactor keeps the canonical URL intact)",
    );

    // The negative-assertion suite covers every captured surface.
    assertNoLeaks({
      parentStderrBlob,
      fakeGitLog,
      argvLines,
      fixtureToken,
      percentEncodedToken,
      base64Token,
    });
  },
);

test(
  "B. ls-remote exit 0 with empty stdout: parent throws 'Unable to resolve remote ref ... from <canonicalUrl>' with no secret leakage",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, tempRoot, fakeBin, logPath } = await buildScenarioHarness(t, "B");
    const { fixtureToken, percentEncodedToken, base64Token } = buildFixtureTokenData();
    const canonicalUrl = "https://github.com/metyatech/teacher-profile-docs.git";

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...buildBaseEnv({ logPath, fixtureToken, canonicalUrl, fakeBin }),
        FAKE_GIT_LS_REMOTE_MODE: "empty-0",
        FAKE_GIT_CLONE_MODE: "ok",
      },
    });

    assert.notEqual(
      result.code,
      0,
      "sync script must exit non-zero when ls-remote returns no output",
    );

    const fakeGitLines = await readFakeGitLog(logPath);
    const argvLines = fakeGitLines.filter((line) => line.startsWith("[argv] "));
    const fakeGitLog = fakeGitLines.join("\n");
    const parentStderrBlob = result.parentStderrBlob;

    // Positive witness: the exception message ("Unable to resolve
    // remote ref ... from <canonicalUrl>") must reach the parent
    // stderr (via Node's uncaught-exception dump). The canonical URL
    // in the exception must be the canonical form, with no userinfo.
    assert.match(
      parentStderrBlob,
      /Unable to resolve remote ref\s+\S+\s+from\s+https:\/\/github\.com\/metyatech\/teacher-profile-docs\.git/iu,
      `parent stderr must contain the 'Unable to resolve remote ref' exception message; got: ${parentStderrBlob}`,
    );

    // The negative-assertion suite covers every captured surface.
    assertNoLeaks({
      parentStderrBlob,
      fakeGitLog,
      argvLines,
      fixtureToken,
      percentEncodedToken,
      base64Token,
    });
  },
);

test(
  "C. ls-remote exit 0 with malformed output (no SHA before the tab): parent throws with no secret leakage",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, tempRoot, fakeBin, logPath } = await buildScenarioHarness(t, "C");
    const { fixtureToken, percentEncodedToken, base64Token } = buildFixtureTokenData();
    const canonicalUrl = "https://github.com/metyatech/teacher-profile-docs.git";

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...buildBaseEnv({ logPath, fixtureToken, canonicalUrl, fakeBin }),
        FAKE_GIT_LS_REMOTE_MODE: "malformed-0",
        FAKE_GIT_CLONE_MODE: "ok",
      },
    });

    // The sync script throws (either the parse-error path or the
    // post-clone required-path check). Either way, the parent process
    // observes a non-zero exit and a parent stderr blob containing
    // the thrown error.
    assert.notEqual(
      result.code,
      0,
      "sync script must exit non-zero when ls-remote returns malformed output",
    );

    const fakeGitLines = await readFakeGitLog(logPath);
    const argvLines = fakeGitLines.filter((line) => line.startsWith("[argv] "));
    const fakeGitLog = fakeGitLines.join("\n");
    const parentStderrBlob = result.parentStderrBlob;

    // The negative-assertion suite covers every captured surface.
    // The specific error message wording for the malformed path
    // depends on the sync script's parser implementation. The
    // binding contract is the redaction property: no token-shaped
    // content in any captured surface. (The current parser treats
    // "\trefs/heads/main" as a valid SHA after trim, so the script
    // proceeds to clone and the post-clone "Missing required path"
    // check fires. Either error path is acceptable; the redaction
    // contract is what this scenario defends.)
    assertNoLeaks({
      parentStderrBlob,
      fakeGitLog,
      argvLines,
      fixtureToken,
      percentEncodedToken,
      base64Token,
    });

    // Positive witness: the canonical URL must appear in argv (the
    // parent test can observe it via the fake-git's log file).
    assert.match(
      argvLines.join("\n"),
      new RegExp(canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "canonical URL must appear in the fake git argv (the sync script passed it through unchanged)",
    );
  },
);

test(
  "D. clone exit 128 after a successful ls-remote: parent surfaces (stderr + exception) never echo the token, x-access-token, percent-encoded, base64, or @github.com userinfo",
  { timeout: 60_000 },
  async (t) => {
    const { fakeSiteRoot, tempRoot, fakeBin, logPath } = await buildScenarioHarness(t, "D");
    const { fixtureToken, percentEncodedToken, base64Token } = buildFixtureTokenData();
    const canonicalUrl = "https://github.com/metyatech/teacher-profile-docs.git";

    const result = await runSyncCapturingParentStderr({
      cwd: fakeSiteRoot,
      env: {
        ...buildBaseEnv({ logPath, fixtureToken, canonicalUrl, fakeBin }),
        FAKE_GIT_LS_REMOTE_MODE: "ok",
        FAKE_GIT_CLONE_MODE: "fail-128-with-secrets",
      },
    });

    // The sync script reached the clone step (ls-remote returned a
    // valid SHA), then the clone failed with exit 128. The production
    // `run` helper writes the redacted stderr to parent.stderr before
    // throwing, so the parent stderr is the primary surface to
    // assert against for this scenario. Node's default uncaught-
    // exception handler also writes the error to the child's stderr,
    // so the captured parent stderr contains both the redacted
    // diagnostics AND the error message.
    assert.notEqual(result.code, 0, "sync script must exit non-zero when clone fails");

    const fakeGitLines = await readFakeGitLog(logPath);
    const argvLines = fakeGitLines.filter((line) => line.startsWith("[argv] "));
    const parsedArgvs = argvLines.map((line) => {
      const raw = line.slice("[argv] ".length);
      try {
        return JSON.parse(raw);
      } catch {
        return raw.split(" ");
      }
    });
    const commands = parsedArgvs.map((a) => a[0]);
    assert.ok(
      commands.includes("ls-remote"),
      `expected fake git to be invoked with ls-remote, got: ${commands.join(", ")}`,
    );
    assert.ok(
      commands.includes("clone"),
      `expected fake git to be invoked with clone, got: ${commands.join(", ")}`,
    );

    // The clone argv must be the canonical URL only (T5 asserts
    // this; re-asserted here so scenario D stands on its own).
    const cloneArgv = parsedArgvs.find((argv) => argv[0] === "clone");
    assert.ok(cloneArgv, "clone argv must be present in the fake git log");
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

    const fakeGitLog = fakeGitLines.join("\n");
    const parentStderrBlob = result.parentStderrBlob;

    // Positive witnesses: the redacted diagnostics must contain the
    // "Authentication failed" literal (the redactor keeps that
    // wording) and the canonical repository name.
    assert.match(
      parentStderrBlob,
      /Authentication failed/iu,
      `parent stderr must mention 'Authentication failed' (the redactor keeps this literal); got: ${parentStderrBlob}`,
    );
    assert.match(
      parentStderrBlob,
      /teacher-profile-docs/,
      "parent stderr must mention the canonical repository name (the redactor keeps the canonical URL intact)",
    );

    // The parent stderr blob is also where the command label from
    // buildCommandFailureError is echoed (the redacted argv). The
    // argv itself is recorded in the fake-git's log; the command
    // label in the parent stderr must be the canonical URL only.
    assert.match(
      parentStderrBlob,
      new RegExp(canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `parent stderr must contain the canonical URL in the command label; got: ${parentStderrBlob}`,
    );

    // The negative-assertion suite covers every captured surface.
    assertNoLeaks({
      parentStderrBlob,
      fakeGitLog,
      argvLines,
      fixtureToken,
      percentEncodedToken,
      base64Token,
    });
  },
);

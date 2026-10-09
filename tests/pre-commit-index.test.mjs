import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = path.join(projectRoot, ".husky", "pre-commit");

function git(cwd, args, options = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", ...options }).trim();
}

async function createHookRepository(t) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "course-docs-hook-index-"));
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  const root = path.join(tempRoot, "repo");
  const hookDir = path.join(tempRoot, "hooks");
  const fakeBin = path.join(tempRoot, "fake-bin");
  await mkdir(root, { recursive: true });
  await mkdir(hookDir, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  const fixtureHook = path.join(hookDir, "pre-commit");
  await writeFile(fixtureHook, await readFile(hookPath));
  await chmod(fixtureHook, 0o755);

  const lintStaged = path.join(fakeBin, "npx");
  await writeFile(lintStaged, '#!/bin/sh\nprintf \'npx:%s\\n\' "$*" >> "$HOOK_TRACE"\nexit 0\n');

  const compose = path.join(fakeBin, "compose-agentsmd");
  await writeFile(
    compose,
    [
      "#!/bin/sh",
      'printf \'compose:%s\\n\' "$*" >> "$HOOK_TRACE"',
      "printf '%s\\n' 'generated agents' > AGENTS.md",
      "printf '%s\\n' 'generated claude' > CLAUDE.md",
      'if [ "${FAIL_COMPOSE:-0}" = 1 ]; then exit 23; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(lintStaged, 0o755);
  await chmod(compose, 0o755);

  await writeFile(path.join(root, "AGENTS.md"), "baseline agents\n");
  await writeFile(path.join(root, "CLAUDE.md"), "baseline claude\n");
  await writeFile(path.join(root, "partial.txt"), "baseline partial\n");
  await writeFile(path.join(root, "unstaged.txt"), "baseline unstaged\n");

  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Hook Test"]);
  git(root, ["config", "user.email", "hook-test@example.invalid"]);
  git(root, ["add", "AGENTS.md", "CLAUDE.md", "partial.txt", "unstaged.txt"]);
  git(root, ["commit", "--quiet", "-m", "baseline"]);
  git(root, ["config", "core.hooksPath", hookDir]);

  const env = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOOK_TRACE: path.join(root, "hook-trace.txt"),
  };

  return { root, env };
}

test("pre-commit commits staged content only and preserves partial and unstaged changes", async (t) => {
  const { root, env } = await createHookRepository(t);
  const originalHead = git(root, ["rev-parse", "HEAD"]);

  await writeFile(path.join(root, "partial.txt"), "staged content\n");
  git(root, ["add", "partial.txt"]);
  await writeFile(path.join(root, "partial.txt"), "staged content\nunstaged continuation\n");
  await writeFile(path.join(root, "unstaged.txt"), "working tree only\n");

  const commit = spawnSync("git", ["commit", "--quiet", "-m", "staged-only test"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(commit.status, 0, `${commit.stdout}\n${commit.stderr}`);

  assert.deepEqual(git(root, ["show", "--format=", "--name-only", "HEAD"]).split(/\r?\n/).sort(), [
    "AGENTS.md",
    "partial.txt",
  ]);
  assert.equal(git(root, ["show", "HEAD:partial.txt"]), "staged content");
  assert.equal(git(root, ["show", "HEAD:unstaged.txt"]), "baseline unstaged");
  assert.equal(git(root, ["show", "HEAD:AGENTS.md"]), "generated agents");
  assert.equal(git(root, ["show", "HEAD:CLAUDE.md"]), "baseline claude");

  assert.equal(
    await readFile(path.join(root, "partial.txt"), "utf8"),
    "staged content\nunstaged continuation\n",
  );
  assert.equal(await readFile(path.join(root, "unstaged.txt"), "utf8"), "working tree only\n");
  assert.equal(await readFile(path.join(root, "CLAUDE.md"), "utf8"), "generated claude\n");
  assert.match(git(root, ["diff", "--", "partial.txt"]), /unstaged continuation/);
  assert.match(git(root, ["diff", "--", "unstaged.txt"]), /working tree only/);
  assert.match(await readFile(env.HOOK_TRACE, "utf8"), /npx:lint-staged[\s\S]*compose:--compose/);
  assert.equal(await readFile(path.join(root, ".git", "index.snap")).catch(() => null), null);
});

test("pre-commit failure after the snapshot leaves the Git index intact", async (t) => {
  const { root, env } = await createHookRepository(t);
  const originalHead = git(root, ["rev-parse", "HEAD"]);

  await writeFile(path.join(root, "partial.txt"), "staged before failure\n");
  git(root, ["add", "partial.txt"]);
  const beforeTree = git(root, ["write-tree"]);
  const beforeBlob = git(root, ["rev-parse", ":partial.txt"]);

  const failed = spawnSync("git", ["commit", "--quiet", "-m", "expected hook failure"], {
    cwd: root,
    env: { ...env, FAIL_COMPOSE: "1" },
    encoding: "utf8",
  });

  assert.notEqual(failed.status, 0, "compose failure must reject the commit");
  assert.equal(git(root, ["write-tree"]), beforeTree);
  assert.equal(git(root, ["rev-parse", ":partial.txt"]), beforeBlob);
  assert.equal(git(root, ["rev-parse", "HEAD"]), originalHead);
  assert.equal(await readFile(path.join(root, ".git", "index.snap")).catch(() => null), null);
  assert.match(await readFile(env.HOOK_TRACE, "utf8"), /compose:--compose/);
});

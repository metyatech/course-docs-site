import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIsolatedNextDistDir } from "../scripts/next-dist-dir.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const stateFile = path.join(
  projectRoot,
  ".course-content",
  "active-platform-sha.txt",
);

// Read the real platform SHA from package.json so the test
// stays correct after any future pin bump.
const pkg = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const platformSpec =
  pkg.dependencies?.["@metyatech/course-docs-platform"] ?? "";
const realSha = platformSpec.match(/#([0-9a-f]+)$/i)?.[1] ?? "";

const fileExists = async (p) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const safeRm = async (p) => {
  await fs.rm(p, { recursive: true, force: true });
};

const runCheck = (env) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/check-platform-cache.mjs"],
      {
        cwd: projectRoot,
        env: { ...process.env, ...env },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

const distDir = createIsolatedNextDistDir("check-platform-cache");
const distDirPath = path.join(projectRoot, ...distDir.split("/"));

const withCleanState = (t, { originalSha }) => {
  t.after(async () => {
    await safeRm(distDirPath);
    if (originalSha) {
      await fs.writeFile(stateFile, originalSha, "utf8");
    } else {
      await fs.rm(stateFile, { force: true });
    }
  });
};

const saveOriginalSha = async () => {
  try {
    return await fs.readFile(stateFile, "utf8");
  } catch {
    return "";
  }
};

test("check-platform-cache clears .next when platform SHA changes", async (t) => {
  const originalSha = await saveOriginalSha();
  withCleanState(t, { originalSha });

  // Write a fake old SHA to simulate a version change.
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, "0000000000000000", "utf8");

  // Create a fake .next-test directory.
  await fs.mkdir(distDirPath, { recursive: true });
  await fs.writeFile(
    path.join(distDirPath, "stale-cache.txt"),
    "stale",
    "utf8",
  );

  const exitCode = await runCheck({
    COURSE_DOCS_NEXT_DIST_DIR: distDir,
  });
  assert.equal(exitCode, 0);
  assert.equal(
    await fileExists(distDirPath),
    false,
    ".next should be cleared when platform SHA changes",
  );

  const newSha = (await fs.readFile(stateFile, "utf8")).trim();
  assert.equal(newSha, realSha, "state file should be updated to current SHA");
});

test("check-platform-cache keeps .next when platform SHA matches", async (t) => {
  const originalSha = await saveOriginalSha();
  withCleanState(t, { originalSha });

  // Write the real SHA — no change expected.
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, realSha, "utf8");

  await fs.mkdir(distDirPath, { recursive: true });
  await fs.writeFile(
    path.join(distDirPath, "keep-this.txt"),
    "keep",
    "utf8",
  );

  const exitCode = await runCheck({
    COURSE_DOCS_NEXT_DIST_DIR: distDir,
  });
  assert.equal(exitCode, 0);
  assert.equal(
    await fileExists(distDirPath),
    true,
    ".next should NOT be cleared when SHA matches",
  );
  assert.equal(
    await fileExists(path.join(distDirPath, "keep-this.txt")),
    true,
    "files inside .next should be preserved",
  );
});

test("check-platform-cache clears .next on first run (no previous SHA) to flush pre-existing stale cache", async (t) => {
  const originalSha = await saveOriginalSha();
  withCleanState(t, { originalSha });

  // Remove state file to simulate first run after the script is introduced.
  await fs.rm(stateFile, { force: true });

  await fs.mkdir(distDirPath, { recursive: true });
  await fs.writeFile(
    path.join(distDirPath, "stale-from-old-platform.txt"),
    "stale",
    "utf8",
  );

  const exitCode = await runCheck({
    COURSE_DOCS_NEXT_DIST_DIR: distDir,
  });
  assert.equal(exitCode, 0);
  assert.equal(
    await fileExists(distDirPath),
    false,
    ".next should be cleared on first run to flush stale cache",
  );

  const newSha = (await fs.readFile(stateFile, "utf8")).trim();
  assert.equal(newSha, realSha, "state file should be written on first run");
});

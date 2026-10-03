import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRunDevTestEnv } from "./test-harness-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runNodeScript = (scriptPath, envFileRoot, args = []) =>
  new Promise((resolve, reject) => {
    const childEnv = createRunDevTestEnv({
      label: `content-source-required-${path.basename(scriptPath, ".mjs")}`,
      env: process.env,
      overrides: {
        COURSE_DOCS_ENV_FILE_DIR: envFileRoot,
        COURSE_DOCS_SITE_DEV_INNER: "stub",
      },
    });
    delete childEnv.COURSE_CONTENT_SOURCE;

    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        envFileRoot: childEnv.COURSE_DOCS_ENV_FILE_DIR,
        hasCourseContentSource: Object.hasOwn(childEnv, "COURSE_CONTENT_SOURCE"),
      });
    });
  });

test(
  "sync and dev fail fast when COURSE_CONTENT_SOURCE is omitted",
  { timeout: 60_000 },
  async (t) => {
    const envFileRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-source-required-env-"));
    t.after(async () => fs.rm(envFileRoot, { recursive: true, force: true }));

    const expectedMessage = "COURSE_CONTENT_SOURCE is required.";

    const syncResult = await runNodeScript("scripts/sync-course-content.mjs", envFileRoot);
    assert.notEqual(syncResult.code, 0);
    assert.equal(syncResult.envFileRoot, envFileRoot);
    assert.equal(syncResult.hasCourseContentSource, false);
    assert.match(`${syncResult.stdout}\n${syncResult.stderr}`, new RegExp(expectedMessage));

    const devResult = await runNodeScript("scripts/run-dev.mjs", envFileRoot, ["--port", "3060"]);
    assert.notEqual(devResult.code, 0);
    assert.equal(devResult.envFileRoot, envFileRoot);
    assert.equal(devResult.hasCourseContentSource, false);
    assert.match(`${devResult.stdout}\n${devResult.stderr}`, new RegExp(expectedMessage));
  },
);

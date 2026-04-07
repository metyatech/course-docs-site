import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  createIsolatedNextDistDir,
  DEFAULT_NEXT_DIST_DIR,
  TEST_NEXT_DIST_DIR,
  normalizeNextEnvDts,
  resolveNextDistDir,
  resolveNextDistDirPath,
} from "../scripts/next-dist-dir.mjs";
import { createPlaywrightWebServerEnv, createRunDevTestEnv } from "./test-harness-env.mjs";

const projectRoot = "D:\\ghws\\course-docs-site";
const playwrightConfigUrl = pathToFileURL(
  path.join(projectRoot, "tests", "e2e", "playwright.config.mjs"),
);

const loadPlaywrightConfigWithoutOverride = async () => {
  const originalDistDir = process.env.COURSE_DOCS_NEXT_DIST_DIR;
  delete process.env.COURSE_DOCS_NEXT_DIST_DIR;

  const importUrl = new URL(playwrightConfigUrl.href);
  importUrl.searchParams.set("ts", `${Date.now()}-${Math.random()}`);

  try {
    const importedConfig = await import(importUrl.href);
    return importedConfig.default;
  } finally {
    if (typeof originalDistDir === "string") {
      process.env.COURSE_DOCS_NEXT_DIST_DIR = originalDistDir;
    } else {
      delete process.env.COURSE_DOCS_NEXT_DIST_DIR;
    }
  }
};

test("resolveNextDistDir defaults to .next", () => {
  assert.equal(resolveNextDistDir({ projectRoot, env: {} }), DEFAULT_NEXT_DIST_DIR);
});

test("resolveNextDistDir accepts project-relative test dist dirs", () => {
  const env = { COURSE_DOCS_NEXT_DIST_DIR: TEST_NEXT_DIST_DIR };
  assert.equal(resolveNextDistDir({ projectRoot, env }), TEST_NEXT_DIST_DIR);
  assert.equal(resolveNextDistDirPath({ projectRoot, env }), path.join(projectRoot, ".next-test"));
});

test("resolveNextDistDir rejects paths outside the project root", () => {
  assert.throws(
    () => resolveNextDistDir({ projectRoot, env: { COURSE_DOCS_NEXT_DIST_DIR: "../outside" } }),
    /project root/i,
  );
});

test("test harnesses stay out of the default .next cache", () => {
  assert.equal(createIsolatedNextDistDir("Admin Mode Route Protection"), TEST_NEXT_DIST_DIR);
  assert.notEqual(
    createRunDevTestEnv({ label: "admin-mode-route-protection" }).COURSE_DOCS_NEXT_DIST_DIR,
    DEFAULT_NEXT_DIST_DIR,
  );
});

test("playwright web server uses an isolated Next dist dir by default", async () => {
  const playwrightConfig = await loadPlaywrightConfigWithoutOverride();
  const configuredDistDir = playwrightConfig.webServer?.env?.COURSE_DOCS_NEXT_DIST_DIR;
  assert.ok(
    configuredDistDir,
    "Expected Playwright webServer env to set COURSE_DOCS_NEXT_DIST_DIR.",
  );
  assert.notEqual(configuredDistDir, DEFAULT_NEXT_DIST_DIR);
  assert.equal(configuredDistDir, TEST_NEXT_DIST_DIR);
});

test("playwright helper preserves explicit dist dir overrides", () => {
  const env = createPlaywrightWebServerEnv({
    label: "playwright-default",
    env: { COURSE_DOCS_NEXT_DIST_DIR: TEST_NEXT_DIST_DIR },
  });
  assert.equal(env.COURSE_DOCS_NEXT_DIST_DIR, TEST_NEXT_DIST_DIR);
});

test("normalizeNextEnvDts restores the canonical typed-route header", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "course-docs-next-env-"));
  const nextEnvPath = path.join(tempRoot, "next-env.d.ts");

  try {
    fs.writeFileSync(
      nextEnvPath,
      [
        '/// <reference types="next" />',
        '/// <reference types="next/image-types/global" />',
        '/// <reference path="./.next-test/types/routes.d.ts" />',
        "",
      ].join("\n"),
      "utf8",
    );

    normalizeNextEnvDts({ projectRoot: tempRoot });

    assert.equal(
      fs.readFileSync(nextEnvPath, "utf8"),
      [
        '/// <reference types="next" />',
        '/// <reference path="./.next/types/routes.d.ts" />',
        "",
      ].join("\n"),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

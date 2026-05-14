import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createIsolatedNextDistDir,
  DEFAULT_NEXT_DIST_DIR,
  TEST_NEXT_DIST_DIR,
  resolveNextDistDir,
  resolveNextDistDirPath,
} from "../scripts/next-dist-dir.mjs";
import { findFirstFreePort, parsePortValue } from "../scripts/port-availability.mjs";
import { createPlaywrightWebServerEnv, createRunDevTestEnv } from "./test-harness-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightConfigUrl = pathToFileURL(
  path.join(projectRoot, "tests", "e2e", "playwright.config.mjs"),
);
const playwrightCiConfigUrl = pathToFileURL(
  path.join(projectRoot, "tests", "e2e", "playwright.ci.config.mjs"),
);
const ciWorkflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");

const loadPlaywrightConfigWithoutOverride = async (configUrl = playwrightConfigUrl) => {
  const originalDistDir = process.env.COURSE_DOCS_NEXT_DIST_DIR;
  delete process.env.COURSE_DOCS_NEXT_DIST_DIR;

  const importUrl = new URL(configUrl.href);
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

const parseVerifyCourseJobEnv = (workflowText) => {
  const lines = workflowText.split(/\r?\n/);
  const jobStart = lines.findIndex((line) => line === "  verify-course:");
  assert.notEqual(jobStart, -1, "Expected CI workflow to define verify-course job.");

  const nextJobStart = lines.findIndex(
    (line, index) => index > jobStart && /^  [A-Za-z0-9_-]+:$/.test(line),
  );
  const jobLines = lines.slice(jobStart, nextJobStart === -1 ? undefined : nextJobStart);
  const envStart = jobLines.findIndex((line) => line === "    env:");
  assert.notEqual(envStart, -1, "Expected verify-course job to define a job-level env block.");

  const env = new Map();
  for (const line of jobLines.slice(envStart + 1)) {
    if (/^    \S/.test(line)) break;

    const match = /^      ([A-Z0-9_]+):\s*(.*)$/.exec(line);
    if (match) env.set(match[1], match[2].replace(/^"(.*)"$/, "$1"));
  }

  return { env, jobText: jobLines.join("\n") };
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

test("playwright CI web server uses the test Next dist dir by default", async () => {
  const playwrightConfig = await loadPlaywrightConfigWithoutOverride(playwrightCiConfigUrl);
  assert.equal(playwrightConfig.webServer?.env?.COURSE_DOCS_NEXT_DIST_DIR, TEST_NEXT_DIST_DIR);
});

test("CI verify-course build and Playwright steps share the test Next dist dir", async () => {
  const workflowText = await readFile(ciWorkflowPath, "utf8");
  const { env, jobText } = parseVerifyCourseJobEnv(workflowText);

  assert.equal(env.get("COURSE_DOCS_NEXT_DIST_DIR"), TEST_NEXT_DIST_DIR);
  assert.match(jobText, /      - name: Build site\n        run: npm run build/);
  assert.match(
    jobText,
    /      - name: Verify course matrix entry\n        run: npm run verify:course:ci/,
  );
});

test("playwright helper preserves explicit dist dir overrides", () => {
  const env = createPlaywrightWebServerEnv({
    label: "playwright-default",
    env: { COURSE_DOCS_NEXT_DIST_DIR: TEST_NEXT_DIST_DIR },
  });
  assert.equal(env.COURSE_DOCS_NEXT_DIST_DIR, TEST_NEXT_DIST_DIR);
});

test("parsePortValue keeps explicit valid ports and rejects invalid input", () => {
  assert.equal(parsePortValue("3101"), 3101);
  assert.equal(parsePortValue(" 0 "), null);
  assert.equal(parsePortValue("not-a-port"), null);
  assert.equal(parsePortValue(undefined), null);
});

test("findFirstFreePort skips an occupied preferred port", async () => {
  const basePort = await findFirstFreePort(3101, { maxAttempts: 100 });
  const blocker = net.createServer();

  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(basePort, resolve);
  });

  try {
    const resolvedPort = await findFirstFreePort(basePort, { maxAttempts: 5 });
    assert.notEqual(resolvedPort, basePort);
    assert.ok(resolvedPort > basePort);
  } finally {
    await new Promise((resolve, reject) => {
      blocker.close((error) => (error ? reject(error) : resolve()));
    });
  }
});


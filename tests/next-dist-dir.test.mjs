import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createIsolatedNextDistDir,
  DEFAULT_NEXT_DIST_DIR,
  ensureNextTsconfig,
  GENERATED_NEXT_TSCONFIG_PREFIX,
  TEST_NEXT_DIST_DIR,
  resolveNextDistDir,
  resolveNextDistDirPath,
  resolveNextTsconfigPath,
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
const gitignorePath = path.join(projectRoot, ".gitignore");
const packageJsonPath = path.join(projectRoot, "package.json");
const preCommitHookPath = path.join(projectRoot, ".husky", "pre-commit");

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

const findJobLines = (lines, jobName) => {
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(jobStart, -1, `Expected CI workflow to define ${jobName} job.`);

  const nextJobStart = lines.findIndex(
    (line, index) => index > jobStart && /^  [A-Za-z0-9_-]+:$/.test(line),
  );
  return lines.slice(jobStart, nextJobStart === -1 ? undefined : nextJobStart);
};

const parseJobEnv = (jobLines) => {
  const envStart = jobLines.findIndex((line) => line === "    env:");
  assert.notEqual(envStart, -1, "Expected job to define a job-level env block.");

  const env = new Map();
  for (const line of jobLines.slice(envStart + 1)) {
    if (/^    \S/.test(line)) break;

    const match = /^      ([A-Z0-9_]+):\s*(.*)$/.exec(line);
    if (match) env.set(match[1], match[2].replace(/^"(.*)"$/, "$1"));
  }

  return env;
};

const parseE2eCourseJob = (workflowText) => {
  const lines = workflowText.split(/\r?\n/);
  const jobLines = findJobLines(lines, "e2e-course");
  const env = parseJobEnv(jobLines);

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
  assert.equal(
    createIsolatedNextDistDir("Admin Mode Route Protection"),
    `${TEST_NEXT_DIST_DIR}/admin-mode-route-protection`,
  );
  assert.notEqual(
    createRunDevTestEnv({ label: "admin-mode-route-protection" }).COURSE_DOCS_NEXT_DIST_DIR,
    DEFAULT_NEXT_DIST_DIR,
  );
});

test("test harness dist dirs are isolated by scope", () => {
  assert.notEqual(createIsolatedNextDistDir("admin"), createIsolatedNextDistDir("editor"));
});

test("run-dev test harness dist dirs are unique across repeated labels", () => {
  const first = createRunDevTestEnv({ label: "admin" }).COURSE_DOCS_NEXT_DIST_DIR;
  const second = createRunDevTestEnv({ label: "admin" }).COURSE_DOCS_NEXT_DIST_DIR;

  assert.notEqual(first, second);
  assert.match(
    first,
    new RegExp(
      `^${TEST_NEXT_DIST_DIR}/admin-${process.pid}-\\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    ),
  );
  assert.match(
    second,
    new RegExp(
      `^${TEST_NEXT_DIST_DIR}/admin-${process.pid}-\\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    ),
  );
});

test("custom dist dirs use an ignored generated tsconfig with the exact Next types include", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "course-docs-next-tsconfig-"));
  const customDistDir = `${TEST_NEXT_DIST_DIR}/admin-mode-route-protection`;
  const env = { COURSE_DOCS_NEXT_DIST_DIR: customDistDir };
  const rootTsconfigContents = `${JSON.stringify(
    {
      include: [
        "**/*.mjs",
        "**/*.ts",
        "**/*.tsx",
        ".next-test/old-scope/types/**/*.ts",
        ".next/types/**/*.ts",
        "src/types/**/*.ts",
        "next-env.d.ts",
      ],
      exclude: ["node_modules", "coverage"],
    },
    null,
    2,
  )}\n`;

  await writeFile(path.join(temporaryRoot, "tsconfig.json"), rootTsconfigContents);

  try {
    assert.equal(
      resolveNextTsconfigPath({ projectRoot: temporaryRoot, env }),
      `${GENERATED_NEXT_TSCONFIG_PREFIX}.next-test-admin-mode-route-protection.json`,
    );

    const generatedTsconfigPath = ensureNextTsconfig({ projectRoot: temporaryRoot, env });
    const generatedTsconfig = JSON.parse(
      await readFile(path.join(temporaryRoot, ...generatedTsconfigPath.split("/")), "utf8"),
    );

    assert.equal(generatedTsconfig.extends, "./tsconfig.json");
    assert.deepEqual(generatedTsconfig.exclude, ["node_modules", "coverage"]);
    assert.deepEqual(generatedTsconfig.include, [
      "**/*.mjs",
      "**/*.ts",
      "**/*.tsx",
      ".next/types/**/*.ts",
      "src/types/**/*.ts",
      "next-env.d.ts",
      `${customDistDir}/types/**/*.ts`,
    ]);
    assert.equal(
      await readFile(path.join(temporaryRoot, "tsconfig.json"), "utf8"),
      rootTsconfigContents,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("tracked root tsconfig stays free of scoped test dist dir includes", async () => {
  const rootTsconfig = JSON.parse(await readFile(path.join(projectRoot, "tsconfig.json"), "utf8"));

  assert.equal(
    rootTsconfig.include.some((include) =>
      new RegExp(`^${TEST_NEXT_DIST_DIR}/(?!types/)`).test(include),
    ),
    false,
  );
});

test("default dist dir keeps the tracked root tsconfig", () => {
  assert.equal(resolveNextTsconfigPath({ projectRoot, env: {} }), "tsconfig.json");
  assert.equal(ensureNextTsconfig({ projectRoot, env: {} }), "tsconfig.json");
});

test("generated Next tsconfig files are ignored", async () => {
  const gitignore = await readFile(gitignorePath, "utf8");
  assert.match(gitignore, /^tsconfig\.next\.generated\*\.json$/m);
});

test("playwright web server uses an isolated Next dist dir by default", async () => {
  const playwrightConfig = await loadPlaywrightConfigWithoutOverride();
  const configuredDistDir = playwrightConfig.webServer?.env?.COURSE_DOCS_NEXT_DIST_DIR;
  assert.ok(
    configuredDistDir,
    "Expected Playwright webServer env to set COURSE_DOCS_NEXT_DIST_DIR.",
  );
  assert.notEqual(configuredDistDir, DEFAULT_NEXT_DIST_DIR);
  assert.equal(configuredDistDir, `${TEST_NEXT_DIST_DIR}/playwright-webserver`);
});

test("playwright CI web server uses the test Next dist dir by default", async () => {
  const playwrightConfig = await loadPlaywrightConfigWithoutOverride(playwrightCiConfigUrl);
  assert.equal(
    playwrightConfig.webServer?.env?.COURSE_DOCS_NEXT_DIST_DIR,
    `${TEST_NEXT_DIST_DIR}/playwright-webserver-ci`,
  );
  assert.equal(
    playwrightConfig.workers,
    2,
    "CI must run two isolated Playwright workers so the full course suite fits the workflow time cap.",
  );
});

test("CI e2e-course job depends on prepare-matrix and runs test:course:ci under the e2e Next dist dir", async () => {
  const workflowText = await readFile(ciWorkflowPath, "utf8");
  const { env, jobText } = parseE2eCourseJob(workflowText);

  assert.match(
    jobText,
    /^    needs: \[prepare-matrix, platform\]$/m,
    "e2e-course job MUST wait for both prepare-matrix and platform.",
  );

  const e2eDistDir = env.get("COURSE_DOCS_NEXT_DIST_DIR");
  assert.ok(
    typeof e2eDistDir === "string",
    "e2e-course job MUST set COURSE_DOCS_NEXT_DIST_DIR at the job env level.",
  );
  assert.match(
    e2eDistDir,
    /^\.next-e2e-\$\{\{\s*matrix\.siteId\s*\}\}$/,
    "e2e-course job MUST set COURSE_DOCS_NEXT_DIST_DIR to `.next-e2e-${{ matrix.siteId }}`.",
  );
  assert.equal(
    e2eDistDir,
    ".next-e2e-${{ matrix.siteId }}",
    "e2e-course job MUST use the canonical `.next-e2e-` prefix with the matrix siteId.",
  );

  assert.equal(
    env.get("E2E_PORT"),
    "${{ matrix.e2ePort }}",
    "e2e-course job MUST forward E2E_PORT from the matrix entry.",
  );

  assert.match(
    jobText,
    /      - name: Run course E2E \(CI\)\n        if: \$\{\{ !matrix\.requiresContentReadToken \}\}\n        run: npm run test:course:ci/,
    "e2e-course job MUST run `npm run test:course:ci` as the public E2E step (no GH_TOKEN).",
  );

  assert.match(
    jobText,
    /      - name: Run course E2E \(CI, private content\)\n        if: \$\{\{ matrix\.requiresContentReadToken \}\}\n        env:\n          GH_TOKEN: \$\{\{ secrets\.COURSE_CONTENT_READ_TOKEN \}\}\n        run: npm run test:course:ci/,
    "e2e-course job MUST run `npm run test:course:ci` as the private E2E step (with GH_TOKEN).",
  );
  assert.equal(
    /run: npm run verify:ci/.test(jobText),
    false,
    "e2e-course job MUST NOT call `verify:ci`; it owns the E2E step only.",
  );
  assert.equal(
    /run: npm run build(?!:|\w)/.test(jobText),
    false,
    "e2e-course job MUST NOT call `npm run build`; the build job is separate.",
  );
});

test("package.json exposes verify:precommit (fast local gate) and verify:ci (CI-equivalent)", async () => {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));

  assert.equal(
    pkg.scripts["verify:course:ci"],
    "npm run verify:sites && npm run test:course:ci && npm run build:verified",
    "verify:course:ci MUST chain verify:sites, the Playwright CI test, and the verified build so local repro matches CI.",
  );
  assert.equal(
    pkg.scripts["verify:ci"],
    "npm run verify:sites && npm run audit:ci && npm run build && npm run verify:course:ci",
    "verify:ci MUST chain the high audit gate, `build`, then `verify:course:ci` so local repro matches CI.",
  );
  assert.equal(
    pkg.scripts.verify,
    "npm run verify:precommit",
    "Generic `verify` MUST remain a tooling-compatible alias for the fast local gate.",
  );
});

test("pre-commit hook uses the fast verify:precommit gate, not the full CI command", async () => {
  const hook = await readFile(preCommitHookPath, "utf8");

  assert.match(
    hook,
    /^npm run verify:precommit$/m,
    "pre-commit hook MUST invoke `npm run verify:precommit`.",
  );
  assert.equal(
    /^npm run verify(?::ci|:course(?::ci)?)?$/m.test(hook),
    false,
    "pre-commit hook MUST NOT invoke verify, verify:ci, verify:course, or verify:course:ci.",
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

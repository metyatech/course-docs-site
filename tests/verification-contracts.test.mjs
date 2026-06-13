import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COURSE_TIMEOUT_MS,
  courses,
  parseCourseTimeoutMs,
  runCourse,
} from "../scripts/test-e2e-matrix.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const readmePath = path.join(projectRoot, "README.md");
const contributingPath = path.join(projectRoot, "CONTRIBUTING.md");
const ciWorkflowPath = path.join(projectRoot, ".github", "workflows", "ci.yml");

const readPackageJson = async () => JSON.parse(await readFile(packageJsonPath, "utf8"));

const extractE2eCourseJob = (workflowText) => {
  const jobHeader = "  e2e-course:\n";
  const jobStart = workflowText.indexOf(jobHeader);
  assert.notEqual(jobStart, -1, "Expected CI workflow to define an e2e-course job.");

  const afterHeader = workflowText.slice(jobStart + jobHeader.length);
  const nextJobStart = afterHeader.search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJobStart === -1 ? afterHeader : afterHeader.slice(0, nextJobStart);
};

const extractPrepareMatrixJob = (workflowText) => {
  const jobHeader = "  prepare-matrix:\n";
  const jobStart = workflowText.indexOf(jobHeader);
  assert.notEqual(jobStart, -1, "Expected CI workflow to define a prepare-matrix job.");

  const afterHeader = workflowText.slice(jobStart + jobHeader.length);
  const nextJobStart = afterHeader.search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJobStart === -1 ? afterHeader : afterHeader.slice(0, nextJobStart);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("fast local scripts do not invoke the full E2E matrix", async () => {
  const pkg = await readPackageJson();
  const matrixPattern = /(?:test-e2e-matrix|test:e2e:matrix|verify:e2e:matrix)/;

  assert.equal(pkg.scripts.test, "npm run test:fast");
  assert.doesNotMatch(pkg.scripts.test, matrixPattern);
  assert.doesNotMatch(pkg.scripts["test:fast"], matrixPattern);
  assert.doesNotMatch(pkg.scripts["test:shared"], matrixPattern);
  assert.doesNotMatch(pkg.scripts["test:e2e-config"], matrixPattern);
  assert.match(pkg.scripts["test:e2e-config"], /dependency-security-contracts\.test\.mjs/);
  assert.doesNotMatch(pkg.scripts["verify:precommit"], matrixPattern);
  assert.doesNotMatch(
    pkg.scripts["verify:precommit"],
    /build:verified|test:shared|admin-mode|tutorial-shot-editor-flow|import-asset-resolution/,
  );
  assert.equal(pkg.scripts["test:e2e:matrix"], "node scripts/test-e2e-matrix.mjs");
  assert.equal(pkg.scripts["verify:e2e:matrix"], "npm run test:e2e:matrix");
  assert.equal(pkg.scripts["audit:ci"], "npm audit --audit-level=high");
  assert.equal(
    pkg.scripts["verify:ci"],
    "npm run verify:sites && npm run audit:ci && npm run build && npm run verify:course:ci",
  );
});

test("verification docs document fast, single-course CI, and explicit matrix tiers", async () => {
  const readme = await readFile(readmePath, "utf8");
  const contributing = await readFile(contributingPath, "utf8");

  for (const documentText of [readme, contributing]) {
    assert.match(documentText, /npm run verify:precommit/);
    assert.match(documentText, /npm run verify:ci/);
    assert.match(documentText, /high-severity dependency audit gate/);
    assert.match(documentText, /npm run test:e2e:matrix/);
    assert.match(documentText, /npm run verify:e2e:matrix/);
  }

  assert.doesNotMatch(
    readme,
    /Run E2E against (?:both|all) course contents:\s*```sh\s*npm test/s,
    "README must not teach users to run the full E2E matrix through npm test.",
  );
});

test("CI matrix drives build and e2e jobs per course source from the manifest", async () => {
  const workflowText = await readFile(ciWorkflowPath, "utf8");
  const prepareJobText = extractPrepareMatrixJob(workflowText);
  const e2eJobText = extractE2eCourseJob(workflowText);

  // prepare-matrix must read the manifest and publish both build and e2e matrices.
  assert.match(
    prepareJobText,
    /echo "build=\$\(node scripts\/print-course-sites-matrix\.mjs --kind build\)" >> \$GITHUB_OUTPUT/,
  );
  assert.match(
    prepareJobText,
    /echo "e2e=\$\(node scripts\/print-course-sites-matrix\.mjs --kind e2e\)" >> \$GITHUB_OUTPUT/,
  );
  assert.match(
    prepareJobText,
    /outputs:[\s\S]*?build: \$\{\{ steps\.set-build-matrix\.outputs\.build \}\}/,
  );
  assert.match(
    prepareJobText,
    /outputs:[\s\S]*?e2e: \$\{\{ steps\.set-e2e-matrix\.outputs\.e2e \}\}/,
  );

  // e2e-course must consume the e2e matrix and run the CI course E2E command per course source.
  assert.match(e2eJobText, /matrix: \$\{\{ fromJson\(needs\.prepare-matrix\.outputs\.e2e\) \}\}/);
  assert.match(e2eJobText, /needs: prepare-matrix/);
  assert.match(e2eJobText, /COURSE_CONTENT_SOURCE: \$\{\{ matrix\.courseSource \}\}/);
  assert.equal((e2eJobText.match(/run: npm run test:course:ci/g) ?? []).length, 1);
  assert.doesNotMatch(e2eJobText, /run: npm run verify:ci/);
  assert.doesNotMatch(e2eJobText, /run: npm run build(?!:)/);
});

test("matrix runner exposes default timeout and validates timeout overrides", () => {
  assert.equal(parseCourseTimeoutMs({}), DEFAULT_COURSE_TIMEOUT_MS);
  assert.equal(parseCourseTimeoutMs({ E2E_MATRIX_COURSE_TIMEOUT_MS: "1234" }), 1234);
  assert.throws(
    () => parseCourseTimeoutMs({ E2E_MATRIX_COURSE_TIMEOUT_MS: "0" }),
    /positive integer/,
  );
});

test("matrix course failures remove suite config and run cleanup around the course", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "course-docs-matrix-contract-"));
  const configPath = path.join(temporaryRoot, "tests", "e2e", ".suite-config.json");
  const cleanupCalls = [];
  const portWaitCalls = [];
  const runCalls = [];

  try {
    const representativeCourse =
      courses.find((course) => course.name === "programming-course-docs") ?? courses[0];
    assert.ok(
      representativeCourse,
      "Expected the matrix to expose at least one representative course.",
    );

    const expectedDefaultSource = representativeCourse?.defaultSource;
    const expectedCourseName = representativeCourse?.name ?? "unknown";

    await assert.rejects(
      () =>
        runCourse(representativeCourse, {
          root: temporaryRoot,
          configPath,
          baseEnv: { E2E_PORT: "42321" },
          timeoutMs: 1234,
          runNpmFn: async (details) => {
            runCalls.push(details);
            assert.equal(existsSync(configPath), true);
            throw new Error("simulated matrix failure");
          },
          cleanupWorktreeDevProcessesFn: (details) => cleanupCalls.push(details),
          waitForPortClosedFn: async (port, options) => portWaitCalls.push({ port, options }),
          log: () => {},
        }),
      /simulated matrix failure/,
    );

    assert.equal(existsSync(configPath), false);
    assert.equal(cleanupCalls.length, 2);
    assert.equal(portWaitCalls.length, 2);
    assert.equal(runCalls.length, 1);
    assert.ok(runCalls[0].timeoutMs > 0);
    assert.ok(runCalls[0].timeoutMs <= 1234);
    assert.equal(runCalls[0].env.E2E_PORT, "42321");
    assert.equal(runCalls[0].env.COURSE_CONTENT_SOURCE, expectedDefaultSource);
    assert.match(runCalls[0].label, new RegExp(expectedCourseName));
    assert.match(runCalls[0].label, /E2E_PORT=42321/);
    assert.match(runCalls[0].label, /timeout=1234 ms/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

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

// Generic version of the per-job extractors above. Slices the workflow text
// from the `  <jobName>:` header up to (but not including) the next
// top-level `  <something>:` key, and returns the body of that job.
const extractJobBody = (workflowText, jobName) => {
  const jobHeader = `  ${jobName}:\n`;
  const jobStart = workflowText.indexOf(jobHeader);
  assert.notEqual(jobStart, -1, `Expected workflow to define a ${jobName} job.`);

  const afterHeader = workflowText.slice(jobStart + jobHeader.length);
  const nextJobStart = afterHeader.search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJobStart === -1 ? afterHeader : afterHeader.slice(0, nextJobStart);
};

// Extract the single `actions/checkout@v6` step block from a job body.
// Asserts exactly one such block exists. The block is the contiguous text
// from the first matching step line up to (but not including) the next
// step (another `      - ` at column 7) or the end of the job body.
const extractCheckoutStep = (jobBody) => {
  // Split the job into lines. A step starts at column 7 with `      - `.
  // The block runs from that line through every line that is *strictly
  // more indented* than the step's start (i.e. starts at column 9 or
  // beyond). A line at the same or lower indentation (or the end of the
  // body) terminates the block.
  const lines = jobBody.split("\n");
  let stepStartIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("      - ")) {
      const blockLines = [lines[i]];
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.startsWith("        ") || line === "") {
          blockLines.push(line);
        } else {
          break;
        }
      }
      const block = blockLines.join("\n");
      if (block.includes("actions/checkout@v6")) {
        if (stepStartIndex !== -1) {
          assert.fail(
            `Expected exactly one actions/checkout@v6 step in the job, found more than one.`,
          );
        }
        stepStartIndex = i;
      }
    }
  }
  assert.notEqual(
    stepStartIndex,
    -1,
    "Expected exactly one actions/checkout@v6 step in the job, found 0.",
  );
  // Reconstruct the block from the discovered start.
  const blockLines = [lines[stepStartIndex]];
  for (let j = stepStartIndex + 1; j < lines.length; j += 1) {
    const line = lines[j];
    if (line.startsWith("        ") || line === "") {
      blockLines.push(line);
    } else {
      break;
    }
  }
  return blockLines.join("\n");
};

const assertCheckoutHasPersistCredentialsFalse = (jobBody, jobName) => {
  const stepBlock = extractCheckoutStep(jobBody);
  assert.match(
    stepBlock,
    /actions\/checkout@v6/,
    `${jobName}: actions/checkout@v6 step must be present.`,
  );
  assert.match(
    stepBlock,
    /persist-credentials: false/,
    `${jobName}: actions/checkout@v6 must set persist-credentials: false so the PR-scoped GITHUB_TOKEN does not leak into sync:content.`,
  );
  // `with:` must be declared *before* `persist-credentials:` on the same
  // step, otherwise the value is detached from its block.
  const withIndex = stepBlock.indexOf("with:");
  const persistIndex = stepBlock.indexOf("persist-credentials: false");
  assert.notEqual(withIndex, -1, `${jobName}: actions/checkout@v6 must declare a 'with:' block.`);
  assert.notEqual(
    persistIndex,
    -1,
    `${jobName}: actions/checkout@v6 must declare 'persist-credentials: false' inside 'with:'.`,
  );
  assert.ok(
    withIndex < persistIndex,
    `${jobName}: 'with:' must be declared before 'persist-credentials: false' on the checkout step.`,
  );
};

// Extract the first step block whose `name:` line matches `stepName`. The
// block is the contiguous text from the matching `      - name: <name>` line
// through every line that is *strictly more indented* than the step's start
// (i.e. starts at column 9 or beyond) or is empty. A line at the same or
// lower indentation (or the end of the body) terminates the block. This
// mirrors the column-7 heuristic used by `extractCheckoutStep` so a step
// can be located by its human-readable name (e.g. `Install`,
// `Typecheck`, `Validate private content read token`).
const extractStepByName = (jobBody, stepName) => {
  const lines = jobBody.split("\n");
  const stepHeader = `      - name: ${stepName}`;
  let stepStartIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === stepHeader || lines[i].startsWith(`${stepHeader}\n`)) {
      stepStartIndex = i;
      break;
    }
  }
  assert.notEqual(
    stepStartIndex,
    -1,
    `Expected to find a step named ${JSON.stringify(stepName)} in the job body.`,
  );

  const blockLines = [lines[stepStartIndex]];
  for (let j = stepStartIndex + 1; j < lines.length; j += 1) {
    const line = lines[j];
    if (line.startsWith("        ") || line === "") {
      blockLines.push(line);
    } else {
      break;
    }
  }
  return blockLines.join("\n");
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
  // The job exposes a public step and a `(private content)` step that both
  // invoke `npm run test:course:ci`. The public step has no `env:` block;
  // the private step carries `GH_TOKEN` for the secret-aware run. T8 will
  // expand this with full public/private step-split invariants.
  assert.equal((e2eJobText.match(/run: npm run test:course:ci/g) ?? []).length, 2);
  assert.match(
    e2eJobText,
    /- name: Run course E2E \(CI\)\n        if: \$\{\{ !matrix\.requiresContentReadToken \}\}\n        run: npm run test:course:ci/,
  );
  assert.match(
    e2eJobText,
    /- name: Run course E2E \(CI, private content\)\n        if: \$\{\{ matrix\.requiresContentReadToken \}\}\n        env:\n          GH_TOKEN: \$\{\{ secrets\.COURSE_CONTENT_READ_TOKEN \}\}\n        run: npm run test:course:ci/,
  );
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

test("ci.yml checkouts in shared, build-course, e2e-course, and prepare-matrix set persist-credentials: false", async () => {
  const workflowText = await readFile(ciWorkflowPath, "utf8");
  for (const jobName of ["shared", "build-course", "e2e-course", "prepare-matrix"]) {
    const jobBody = extractJobBody(workflowText, jobName);
    assertCheckoutHasPersistCredentialsFalse(jobBody, `ci.yml:${jobName}`);
  }
});

test("redeploy-content-sites.yml prepare-matrix checkout sets persist-credentials: false", async () => {
  const redeployWorkflowPath = path.join(
    projectRoot,
    ".github",
    "workflows",
    "redeploy-content-sites.yml",
  );
  const workflowText = await readFile(redeployWorkflowPath, "utf8");
  const prepareMatrixBody = extractJobBody(workflowText, "prepare-matrix");
  assertCheckoutHasPersistCredentialsFalse(
    prepareMatrixBody,
    "redeploy-content-sites.yml:prepare-matrix",
  );
});

test("ci.yml build-course and e2e-course keep COURSE_CONTENT_READ_TOKEN step-scoped (no job-level GH_TOKEN; public steps have no GH_TOKEN; private steps carry it gated on matrix; npm ci never sees it; preflight is unchanged)", async (t) => {
  const workflowText = await readFile(ciWorkflowPath, "utf8");
  const jobLevelSecretLine = /^ {6}GH_TOKEN: \$\{\{ secrets\.COURSE_CONTENT_READ_TOKEN \}\}$/m;
  const stepGateLine = "if: ${{ matrix.requiresContentReadToken }}";
  const stepSecretLine = "GH_TOKEN: ${{ secrets.COURSE_CONTENT_READ_TOKEN }}";
  const preflightSecretLine = "CONTENT_READ_TOKEN: ${{ secrets.COURSE_CONTENT_READ_TOKEN }}";

  const publicStepsByJob = {
    "build-course": ["Typecheck", "Build (verified)"],
    "e2e-course": ["Typecheck", "Build (verified)", "Run course E2E (CI)"],
  };
  const privateStepsByJob = {
    "build-course": ["Typecheck (private content)", "Build (verified, private content)"],
    "e2e-course": [
      "Typecheck (private content)",
      "Build (verified, private content)",
      "Run course E2E (CI, private content)",
    ],
  };
  const preflightStepName = "Validate private content read token";

  for (const jobName of Object.keys(publicStepsByJob)) {
    const jobBody = extractJobBody(workflowText, jobName);

    await t.test(`${jobName}: no job-level GH_TOKEN on COURSE_CONTENT_READ_TOKEN`, () => {
      assert.doesNotMatch(
        jobBody,
        jobLevelSecretLine,
        `${jobName}: job-level env: must not contain GH_TOKEN mapped from COURSE_CONTENT_READ_TOKEN. ` +
          `The secret is only allowed inside step-level env: blocks (indented 8+ spaces).`,
      );
      // Sanity: a step-level form (column 11) is still permitted and the
      // job body should still contain the secret string somewhere so the
      // negative assertion above is meaningful.
      assert.ok(
        jobBody.includes(stepSecretLine),
        `${jobName}: expected at least one step-level GH_TOKEN: line (column 11) to exist ` +
          `so the job-level negative assertion is meaningful.`,
      );
    });

    for (const stepName of publicStepsByJob[jobName]) {
      await t.test(`${jobName}: public step "${stepName}" has no GH_TOKEN`, () => {
        const stepBlock = extractStepByName(jobBody, stepName);
        assert.doesNotMatch(
          stepBlock,
          /GH_TOKEN:/,
          `${jobName}:${stepName} is the public variant and must not declare a GH_TOKEN env ` +
            `entry of any form (column 11 or column 7).`,
        );
        // Public steps are gated on !matrix.requiresContentReadToken.
        assert.match(
          stepBlock,
          /if: \$\{\{ !matrix\.requiresContentReadToken \}\}/,
          `${jobName}:${stepName} is the public variant and must be gated on ` +
            `!matrix.requiresContentReadToken so private matrix entries skip it.`,
        );
      });
    }

    for (const stepName of privateStepsByJob[jobName]) {
      await t.test(
        `${jobName}: private step "${stepName}" carries GH_TOKEN gated on matrix`,
        () => {
          const stepBlock = extractStepByName(jobBody, stepName);
          assert.match(
            stepBlock,
            new RegExp(escapeRegExp(stepGateLine)),
            `${jobName}:${stepName} (private content) must be gated on ` +
              `matrix.requiresContentReadToken so public matrix entries skip it.`,
          );
          assert.match(
            stepBlock,
            new RegExp(escapeRegExp(stepSecretLine)),
            `${jobName}:${stepName} (private content) must declare ` +
              `GH_TOKEN: \${{ secrets.COURSE_CONTENT_READ_TOKEN }} in its step-level env: block.`,
          );
          // The step-level env: must host the secret — not the job-level env:.
          // A column-7 GH_TOKEN line inside the step block would indicate the
          // secret leaked to job-level, which is exactly what we forbid.
          assert.doesNotMatch(
            stepBlock,
            jobLevelSecretLine,
            `${jobName}:${stepName} (private content) must keep GH_TOKEN inside the step-level ` +
              `env: block (column 11), not at column 7 (job-level).`,
          );
        },
      );
    }

    await t.test(`${jobName}: Install (npm ci) step has no GH_TOKEN`, () => {
      const stepBlock = extractStepByName(jobBody, "Install");
      assert.match(
        stepBlock,
        /run: npm ci/,
        `${jobName}:Install must invoke \`npm ci\` so the no-GH_TOKEN assertion targets the right step.`,
      );
      assert.doesNotMatch(
        stepBlock,
        /GH_TOKEN:/,
        `${jobName}:Install (\`npm ci\`) must not expose a GH_TOKEN env entry, otherwise the ` +
          `secret would be visible to every transitive npm postinstall / lifecycle script.`,
      );
    });

    await t.test(`${jobName}: preflight "${preflightStepName}" is unchanged`, () => {
      const stepBlock = extractStepByName(jobBody, preflightStepName);
      assert.match(
        stepBlock,
        new RegExp(escapeRegExp(stepGateLine)),
        `${jobName}:${preflightStepName} (preflight) must remain gated on ` +
          `matrix.requiresContentReadToken.`,
      );
      assert.match(
        stepBlock,
        new RegExp(escapeRegExp(preflightSecretLine)),
        `${jobName}:${preflightStepName} (preflight) must still use CONTENT_READ_TOKEN ` +
          `(not GH_TOKEN) so the secret name does not appear in the validate-only path.`,
      );
      assert.doesNotMatch(
        stepBlock,
        /GH_TOKEN:/,
        `${jobName}:${preflightStepName} (preflight) must not introduce GH_TOKEN; the ` +
          `preflight only validates presence and the per-step GH_TOKEN delivery is owned by the ` +
          `(private content) Typecheck / Build / E2E steps.`,
      );
    });
  }
});

test("ci.yml checkout steps in shared, build-course, e2e-course, and prepare-matrix still set persist-credentials: false (sanity after step split)", async () => {
  // The T3 step-split work did not touch the checkout steps, so the
  // pre-existing `assertCheckoutHasPersistCredentialsFalse` assertions
  // should still pass. This test re-asserts them explicitly to localize a
  // regression if the step split is ever refactored in a way that
  // accidentally disturbs a checkout.
  const workflowText = await readFile(ciWorkflowPath, "utf8");
  for (const jobName of ["shared", "build-course", "e2e-course", "prepare-matrix"]) {
    const jobBody = extractJobBody(workflowText, jobName);
    assertCheckoutHasPersistCredentialsFalse(jobBody, `ci.yml:${jobName}`);
  }
});

test("verify-content is a site-owned synced-content quality gate, run after sync:content", async () => {
  const pkg = await readPackageJson();

  assert.equal(
    pkg.scripts["verify:content"],
    "node scripts/verify-content.mjs",
    "verify:content must invoke the shared content checker.",
  );

  for (const command of ["build", "build:verified", "typecheck"]) {
    const value = pkg.scripts[command];
    assert.ok(
      typeof value === "string" && value.length > 0,
      `${command} script must be defined and non-empty.`,
    );
    assert.match(
      value,
      /npm run sync:content/,
      `${command} must start with \`npm run sync:content\` so sync always runs first.`,
    );
    assert.match(
      value,
      /npm run verify:content/,
      `${command} must invoke verify:content immediately after sync:content so course content quality is checked before any expensive build/typecheck work.`,
    );
    const syncIndex = value.indexOf("npm run sync:content");
    const verifyIndex = value.indexOf("npm run verify:content");
    assert.ok(
      syncIndex >= 0 && verifyIndex >= 0 && verifyIndex > syncIndex,
      `${command} must run verify:content after sync:content (sync at ${syncIndex}, verify at ${verifyIndex}).`,
    );
  }

  // The shared checker must not drag @metyatech/course-docs-platform into a
  // content-validation path; the verifier is intentionally platform-free.
  assert.doesNotMatch(
    pkg.scripts["verify:content"],
    /course-docs-platform/,
    "verify:content must remain platform-free (course-docs-platform is deprecated).",
  );
});

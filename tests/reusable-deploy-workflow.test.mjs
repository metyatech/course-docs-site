import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/deploy-course.yml", import.meta.url);
const workflow = readFileSync(workflowPath, "utf8");

test("reusable deployment workflow is callable and uses explicit Vercel secrets", () => {
  assert.match(workflow, /^  workflow_call:/m);
  assert.match(workflow, /VERCEL_TOKEN:\s*\n\s+required: true/);
  assert.match(workflow, /VERCEL_ORG_ID:\s*\n\s+required: true/);
  assert.match(workflow, /VERCEL_PROJECT_ID:\s*\n\s+required: true/);
  assert.doesNotMatch(workflow, /secrets:\s*inherit/);
});

test("reusable deployment checks the caller project before building and deploying", () => {
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /repository: metyatech\/course-docs-site[\s\S]*?ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /VERCEL_PROJECT_ID/);
  assert.match(workflow, /project\.id !== projectId/);
  assert.match(
    workflow,
    /vercel@\$\{\{ env\.VERCEL_CLI_VERSION \}\} pull --yes --environment=production/,
  );
  assert.match(workflow, /vercel@\$\{\{ env\.VERCEL_CLI_VERSION \}\} build --prod/);
  assert.match(workflow, /vercel@\$\{\{ env\.VERCEL_CLI_VERSION \}\} deploy --prebuilt --prod/);
  assert.match(workflow, /retry once/);
  assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /node-version: 24/);
});

test("Student Works URL is an optional shared workflow input", () => {
  assert.match(workflow, /next_public_works_base_url:[\s\S]*?required: false[\s\S]*?default: ""/);
  assert.match(
    workflow,
    /NEXT_PUBLIC_WORKS_BASE_URL_INPUT: \$\{\{ inputs\.next_public_works_base_url \}\}/,
  );
  assert.match(workflow, /NEXT_PUBLIC_WORKS_BASE_URL=\$\{value\}/);
});

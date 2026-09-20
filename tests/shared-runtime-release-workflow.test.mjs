import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  checkoutLogContains,
  dispatchAndWait,
  findReleaseRun,
} from "../scripts/dispatch-course-deployment.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => fs.readFile(path.join(projectRoot, relativePath), "utf8");

test("shared deploy workflow checks out the selected runtime and defaults to production-runtime", async () => {
  const workflow = await readProjectFile(".github/workflows/deploy-course.yml");
  assert.match(
    workflow,
    /shared_runtime_ref:[\s\S]*?required:\s*false[\s\S]*?default:\s*production-runtime/u,
  );
  assert.match(
    workflow,
    /repository:\s*metyatech\/course-docs-site[\s\S]*?ref:\s*\$\{\{ inputs\.shared_runtime_ref \}\}/u,
  );
  assert.match(workflow, /Shared runtime SHA: \$\{SHARED_RUNTIME_SHA\}/u);
  assert.match(workflow, /Content SHA: \$\{CONTENT_SHA\}/u);
});

test("automatic shared-main Production fanout is absent and release is manual", async () => {
  const workflowDirectory = path.join(projectRoot, ".github", "workflows");
  const files = await fs.readdir(workflowDirectory);
  assert.ok(!files.includes("redeploy-content-sites.yml"));
  const releaseWorkflow = await readProjectFile(".github/workflows/release-shared-runtime.yml");
  assert.match(releaseWorkflow, /workflow_dispatch:/u);
  assert.doesNotMatch(releaseWorkflow, /^\s+workflow_run:/mu);
  assert.equal(YAML.parse(releaseWorkflow).name, "Release shared runtime");
});

test("release verifies main CI and history, dispatches exact SHA, then smoke-tests before pointer update", async () => {
  const workflow = await readProjectFile(".github/workflows/release-shared-runtime.yml");
  assert.match(
    workflow,
    /Checkout shared history[\s\S]*?Setup Node[\s\S]*?actions\/setup-node@v6/u,
  );
  assert.match(workflow, /Install npm 11\.19\.1[\s\S]*?run: npm install --global npm@11\.19\.1/u);
  assert.match(workflow, /target_sha:[\s\S]*?required:\s*false/u);
  assert.match(workflow, /TARGET_SHA_INPUT:-\$WORKFLOW_SHA/u);
  assert.match(workflow, /git merge-base --is-ancestor "\$TARGET_SHA" origin\/main/u);
  assert.match(
    workflow,
    /actions\/workflows\/ci\.yml\/runs\?head_sha=\$\{TARGET_SHA\}&event=push/u,
  );
  assert.match(workflow, /discover-course-repositories\.mjs --kind release/u);
  assert.match(workflow, /COURSE_CONTENT_REDEPLOY_TOKEN/u);
  assert.match(workflow, /TARGET_SHA: \$\{\{ needs\.preflight\.outputs\.target_sha \}\}/u);
  assert.match(workflow, /needs: \[preflight, deploy\]/u);
  assert.match(workflow, /run: node scripts\/smoke-production-sites\.mjs/u);

  const advanceJob = workflow.slice(workflow.indexOf("  advance-production-runtime:"));
  assert.match(advanceJob, /needs: \[preflight, deploy, smoke\]/u);
  assert.match(
    advanceJob,
    /needs\.deploy\.result == 'success'[\s\S]*needs\.smoke\.result == 'success'/u,
  );
  assert.match(advanceJob, /git merge-base --is-ancestor "\$CURRENT_SHA" "\$TARGET_SHA"/u);
  assert.match(advanceJob, /-F force=false/u);
  assert.doesNotMatch(advanceJob, /-F force=true/u);
});

test("dispatch helper selects one correlated workflow run and verifies content and runtime checkout SHAs", async () => {
  const targetSha = "a".repeat(40);
  const contentSha = "b".repeat(40);
  const repository = "metyatech/sample-course-docs";
  const releaseId = "42-1";
  const title = `Deploy [shared-runtime-release:${releaseId}] with ${targetSha}`;
  const run = {
    databaseId: 123,
    event: "workflow_dispatch",
    displayTitle: title,
    headBranch: "master",
    headSha: contentSha,
    status: "completed",
    conclusion: "success",
    url: "https://github.com/metyatech/sample-course-docs/actions/runs/123",
  };
  const log = [
    "Run actions/checkout@v6",
    `  ref: ${contentSha}`,
    "  path: course-content",
    `  repository: ${repository}`,
    "Run actions/checkout@v6",
    `  ref: ${targetSha}`,
    "  path: site",
    "  repository: metyatech/course-docs-site",
    `  shared_runtime_ref: ${targetSha}`,
  ].join("\n");
  const calls = [];
  const command = async (args) => {
    calls.push(args);
    if (args[0] === "run" && args[1] === "list") return JSON.stringify([run]);
    if (args[0] === "run" && args[1] === "view" && args.includes("--log")) return log;
    if (args[0] === "run" && args[1] === "view") return JSON.stringify(run);
    return "";
  };

  const selected = findReleaseRun([run], { releaseId, targetSha });
  assert.equal(selected.databaseId, 123);
  assert.equal(
    checkoutLogContains(log, { repository, path: "course-content", ref: contentSha }),
    true,
  );

  const details = await dispatchAndWait({
    repository,
    workflow: "deploy-vercel.yml",
    ref: "master",
    targetSha,
    releaseId,
    command,
    delay: async () => {},
  });
  assert.equal(details.conclusion, "success");
  assert.deepEqual(calls[0], [
    "workflow",
    "run",
    "deploy-vercel.yml",
    "--repo",
    repository,
    "--ref",
    "master",
    "-f",
    `shared_runtime_ref=${targetSha}`,
    "-f",
    `release_id=${releaseId}`,
  ]);
  assert.ok(calls.some((args) => args[0] === "run" && args[1] === "watch"));
});

test("release smoke contract covers required site routes, assets, admin mode, comments, and exclusions", async () => {
  const smoke = await readProjectFile("scripts/smoke-production-sites.mjs");
  for (const required of [
    "/docs/intro/",
    "demo-complete.mp4",
    "video-poster.svg",
    "night-escape-stage-layout.svg",
    "/submissions/",
    "/api/admin/mode",
    "text-markup-complete.zip",
    "/rest/v1/work_comments",
    "comment-panel",
    "/api/dev/revision/stream/",
    "/api/dev/tutorial-shots/save/",
    "/asset/",
    "/docs/intro/index.mdx",
    "/_meta.ts",
  ]) {
    assert.ok(smoke.includes(required), `Production smoke must cover ${required}.`);
  }
});

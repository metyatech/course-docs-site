import { appendFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const RELEASE_RUN_NAME_PREFIX = "Deploy [shared-runtime-release:";
const MAX_RUN_DISCOVERY_ATTEMPTS = 30;
const RUN_DISCOVERY_DELAY_MS = 2000;

const requiredValue = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const runGh = async (args) => {
  const { stdout } = await execFile("gh", args, {
    env: process.env,
    maxBuffer: 25 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
};

const parseRunList = (value) => {
  let runs;
  try {
    runs = JSON.parse(value);
  } catch {
    throw new Error("GitHub CLI returned invalid workflow-run JSON.");
  }
  if (!Array.isArray(runs)) {
    throw new Error("GitHub CLI returned an invalid workflow-run list.");
  }
  return runs;
};

export const findReleaseRun = (runs, { releaseId, targetSha }) => {
  const title = `${RELEASE_RUN_NAME_PREFIX}${releaseId}] with ${targetSha}`;
  const matches = runs.filter(
    (run) => run.event === "workflow_dispatch" && run.displayTitle === title,
  );
  if (matches.length > 1) {
    throw new Error(`Multiple deployment runs matched release ${releaseId}.`);
  }
  return matches[0] ?? null;
};

export const checkoutLogContains = (log, { repository, path, ref }) => {
  const checkoutBlocks = log.split(/(?=Run actions\/checkout@v6)/u);
  return checkoutBlocks.some((block) => {
    const hasValue = (key, value) =>
      block.split(/\r?\n/u).some((line) => line.trim().endsWith(`${key}: ${value}`));
    return hasValue("repository", repository) && hasValue("path", path) && hasValue("ref", ref);
  });
};

const appendRunSummary = async ({ repository, targetSha, contentSha, run }) => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  await appendFile(
    summaryPath,
    [
      `### ${repository}`,
      `- Workflow run: ${run.url}`,
      `- Content repository SHA: ${contentSha}`,
      `- Shared runtime SHA: ${targetSha}`,
      "",
    ].join("\n"),
  );
};

export const dispatchAndWait = async ({
  repository,
  workflow,
  ref,
  targetSha,
  releaseId,
  command = runGh,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) => {
  await command([
    "workflow",
    "run",
    workflow,
    "--repo",
    repository,
    "--ref",
    ref,
    "-f",
    `shared_runtime_ref=${targetSha}`,
    "-f",
    `release_id=${releaseId}`,
  ]);

  let run;
  for (let attempt = 0; attempt < MAX_RUN_DISCOVERY_ATTEMPTS; attempt += 1) {
    const output = await command([
      "run",
      "list",
      "--repo",
      repository,
      "--workflow",
      workflow,
      "--event",
      "workflow_dispatch",
      "--json",
      "databaseId,event,displayTitle,headBranch,headSha,status,conclusion,url",
      "--limit",
      "100",
    ]);
    run = findReleaseRun(parseRunList(output), { releaseId, targetSha });
    if (run) {
      break;
    }
    if (attempt + 1 < MAX_RUN_DISCOVERY_ATTEMPTS) {
      await delay(RUN_DISCOVERY_DELAY_MS);
    }
  }

  if (!run) {
    throw new Error(`No deployment workflow run appeared for ${repository} within 60 seconds.`);
  }
  if (run.headBranch !== ref || !/^(?:[\da-f]{40}|[\da-f]{64})$/iu.test(run.headSha ?? "")) {
    throw new Error(`Deployment run for ${repository} did not use its discovered default branch.`);
  }

  await command([
    "run",
    "watch",
    String(run.databaseId),
    "--repo",
    repository,
    "--interval",
    "15",
    "--exit-status",
  ]);

  const detailsOutput = await command([
    "run",
    "view",
    String(run.databaseId),
    "--repo",
    repository,
    "--json",
    "databaseId,event,displayTitle,headBranch,headSha,status,conclusion,url",
  ]);
  const details = JSON.parse(detailsOutput);
  if (details.status !== "completed" || details.conclusion !== "success") {
    throw new Error(`Deployment run for ${repository} did not complete successfully.`);
  }
  if (
    details.displayTitle !== run.displayTitle ||
    details.headBranch !== ref ||
    !/^(?:[\da-f]{40}|[\da-f]{64})$/iu.test(details.headSha ?? "")
  ) {
    throw new Error(`Deployment run identity changed while waiting for ${repository}.`);
  }

  const log = await command(["run", "view", String(run.databaseId), "--repo", repository, "--log"]);
  if (
    !checkoutLogContains(log, {
      repository,
      path: "course-content",
      ref: details.headSha,
    })
  ) {
    throw new Error(`Deployment logs for ${repository} do not record the content commit SHA.`);
  }
  if (
    !checkoutLogContains(log, {
      repository: "metyatech/course-docs-site",
      path: "site",
      ref: targetSha,
    }) ||
    !log.includes(`shared_runtime_ref: ${targetSha}`)
  ) {
    throw new Error(`Deployment logs for ${repository} do not record shared runtime ${targetSha}.`);
  }

  await appendRunSummary({
    repository,
    targetSha,
    contentSha: details.headSha,
    run: details,
  });
  process.stdout.write(
    `${repository}: success; content=${details.headSha}; shared-runtime=${targetSha}; run=${details.url}\n`,
  );
  return details;
};

const runCli = async () => {
  const repository = requiredValue("COURSE_REPOSITORY");
  const workflow = requiredValue("COURSE_WORKFLOW");
  const ref = requiredValue("COURSE_REF");
  const targetSha = requiredValue("TARGET_SHA").toLowerCase();
  const releaseId = requiredValue("RELEASE_ID");
  if (!/^(?:[\da-f]{40}|[\da-f]{64})$/u.test(targetSha)) {
    throw new Error("TARGET_SHA must be a full immutable commit SHA.");
  }
  if (!/^[\w-]+$/u.test(releaseId)) {
    throw new Error("RELEASE_ID must contain only letters, digits, underscores, or hyphens.");
  }
  await dispatchAndWait({ repository, workflow, ref, targetSha, releaseId });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`[dispatch-course-deployment] ${error.message}`);
    process.exitCode = 1;
  });
}

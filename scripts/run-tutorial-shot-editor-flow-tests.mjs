import { spawn } from "node:child_process";
import process from "node:process";
import { cleanupWorktreeDevProcesses } from "../tests/test-harness-env.mjs";

const testFile = "tests/tutorial-shot-editor-flow.test.mjs";

const testNames = [
  "tutorial shot editor saves one boxed focal point with an optional arrow",
  "tutorial shot editor can edit an Action image whose filename contains spaces",
  "tutorial shot editor accepts an image pasted from the clipboard",
  "tutorial shot editor imports a dropped source image",
  "tutorial shot editor preserves a dropped WebP source image and generates WebP output",
  "tutorial shot editor save refreshes the open dev tutorial page to the latest image",
  "tutorial shot editor save refreshes the open dev tutorial page after saving a Verify image",
  "tutorial shot editor canvas keeps PowerPoint-like resize and callout drag behavior wired in",
  "dev auto reload does not reload the tutorial shot editor itself",
  "tutorial shot editor reorders callout numbers from the sidebar list",
  "tutorial shot editor clears selection on empty canvas clicks",
  "tutorial shot editor shows a wider canvas when saved annotations overflow the image",
  "tutorial shot editor API sees COURSE_CONTENT_SOURCE from .env.course.local",
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const runOne = (testName) =>
  new Promise((resolve, reject) => {
    console.log(`[tutorial-shot-editor-flow] ${testName}`);
    cleanupWorktreeDevProcesses();
    const child = spawn(
      process.execPath,
      ["--test", "--test-concurrency=1", "--test-name-pattern", `^${escapeRegExp(testName)}$`, testFile],
      {
        env: process.env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      cleanupWorktreeDevProcesses();
      resolve(code ?? 1);
    });
  });

for (const testName of testNames) {
  const exitCode = await runOne(testName);
  if (exitCode !== 0) {
    console.error(`[tutorial-shot-editor-flow] ${testName} failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

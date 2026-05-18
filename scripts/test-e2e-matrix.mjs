import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { formatContentSource, parseContentSource } from "./content-source.mjs";
import { createIsolatedNextDistDir } from "./next-dist-dir.mjs";
import { findFirstFreePort, parsePortValue } from "./port-availability.mjs";
import {
  cleanupWorktreeDevProcesses,
  killProcessTree,
  waitForPortClosed,
  waitForProcessExit,
} from "../tests/test-harness-env.mjs";

const require = createRequire(import.meta.url);
const { resolveCourseSuiteConfig } = require("../tests/e2e/course-defaults.cjs");

export const projectRoot = process.cwd();
export const suiteConfigPath = path.join(projectRoot, "tests", "e2e", ".suite-config.json");
export const DEFAULT_COURSE_TIMEOUT_MS = 15 * 60 * 1000;
const COURSE_TIMEOUT_ENV = "E2E_MATRIX_COURSE_TIMEOUT_MS";
const CLEANUP_TIMEOUT_SECONDS = 30;
const PORT_CLEANUP_TIMEOUT_MS = 30_000;

export const courses = [
  {
    name: "programming-course-docs",
    sourceEnv: "E2E_PROGRAMMING_CONTENT_SOURCE",
    defaultSource: "github:metyatech/programming-course-docs#master",
  },
  {
    name: "javascript-course-docs",
    sourceEnv: "E2E_JAVASCRIPT_CONTENT_SOURCE",
    defaultSource: "github:metyatech/javascript-course-docs#master",
  },
  {
    name: "open-campus-unreal-90min",
    sourceEnv: "E2E_OPEN_CAMPUS_CONTENT_SOURCE",
    defaultSource: "github:metyatech/open-campus-unreal-90min#main",
  },
];

const messageFrom = (reason) => (reason instanceof Error ? reason.message : String(reason));

export const parseCourseTimeoutMs = (env = process.env) => {
  const rawValue = env[COURSE_TIMEOUT_ENV]?.trim();
  if (!rawValue) {
    return DEFAULT_COURSE_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${COURSE_TIMEOUT_ENV} must be a positive integer number of milliseconds.`);
  }

  return parsed;
};

export const removeSuiteConfig = (targetPath = suiteConfigPath) => {
  try {
    fs.rmSync(targetPath, { force: true });
  } catch (error) {
    throw new Error(`Failed to remove suite config ${targetPath}: ${error.message}`);
  }
};

const trackChild = (child, activeChildren) => {
  if (!activeChildren) {
    return;
  }

  activeChildren.add(child);
  const untrack = () => activeChildren.delete(child);
  child.once("exit", untrack);
  child.once("close", untrack);
};

export const runCommandWithDeadline = async ({
  command,
  args,
  env,
  label,
  timeoutMs,
  cwd = projectRoot,
  stdio = "inherit",
  activeChildren,
}) => {
  const child = spawn(command, args, {
    cwd,
    stdio,
    shell: false,
    env,
    windowsHide: true,
  });
  trackChild(child, activeChildren);

  try {
    await waitForProcessExit(child, label, { timeoutMs });
  } catch (error) {
    await killProcessTree(child);
    throw error;
  }
};

export const runNpm = async ({
  args,
  env,
  label,
  timeoutMs,
  cwd = projectRoot,
  activeChildren,
}) => {
  if (process.platform === "win32") {
    await runCommandWithDeadline({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
      env,
      label,
      timeoutMs,
      cwd,
      activeChildren,
    });
    return;
  }

  await runCommandWithDeadline({
    command: "npm",
    args,
    env,
    label,
    timeoutMs,
    cwd,
    activeChildren,
  });
};

const readEnvFile = (filename) => {
  const envPath = path.join(projectRoot, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return dotenv.parse(fs.readFileSync(envPath, "utf8"));
  } catch (error) {
    console.warn(`[e2e-matrix] Ignoring unreadable env file ${filename}: ${error.message}`);
    return {};
  }
};

export const loadEnvDefaults = () => {
  const explicitKeys = new Set(Object.keys(process.env));
  const fileEnv = {
    ...readEnvFile(".env"),
    ...readEnvFile(".env.local"),
    ...readEnvFile(".env.e2e"),
    ...readEnvFile(".env.e2e.local"),
  };

  for (const [key, value] of Object.entries(fileEnv)) {
    if (!explicitKeys.has(key)) {
      process.env[key] = value;
    }
  }
};

export const resolveMatrixE2ePort = async (env) => {
  const explicitPort = parsePortValue(env.E2E_PORT);
  if (explicitPort !== null) {
    return explicitPort;
  }

  return await findFirstFreePort(3101);
};

export const resolveCourseEnv = (course, baseEnv = process.env, root = projectRoot) => {
  const env = { ...baseEnv };
  const sourceText = baseEnv[course.sourceEnv]?.trim() || course.defaultSource;
  const source = parseContentSource(sourceText);

  if (source.kind === "local") {
    const localPath = path.resolve(root, source.localDir);
    if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
      throw new Error(`${course.sourceEnv} points to a non-directory path: ${source.localDir}`);
    }

    env.COURSE_CONTENT_SOURCE = source.localDir;
    return { env, sourceLabel: `${course.sourceEnv}=${source.localDir}` };
  }

  env.COURSE_CONTENT_SOURCE = formatContentSource(source);
  return {
    env,
    sourceLabel: `${course.sourceEnv}=${env.COURSE_CONTENT_SOURCE}`,
  };
};

export const cleanupCourseState = async ({
  root = projectRoot,
  configPath = suiteConfigPath,
  port,
  cleanupWorktreeDevProcessesFn = cleanupWorktreeDevProcesses,
  waitForPortClosedFn = waitForPortClosed,
}) => {
  const cleanupErrors = [];

  try {
    removeSuiteConfig(configPath);
  } catch (error) {
    cleanupErrors.push(error);
  }

  try {
    cleanupWorktreeDevProcessesFn({ projectRoot: root, timeoutSeconds: CLEANUP_TIMEOUT_SECONDS });
  } catch (error) {
    cleanupErrors.push(error);
  }

  const parsedPort = parsePortValue(port == null ? undefined : String(port));
  if (parsedPort !== null) {
    try {
      await waitForPortClosedFn(parsedPort, { timeoutMs: PORT_CLEANUP_TIMEOUT_MS });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new Error(cleanupErrors.map((error) => error.message).join("\n"), {
      cause: cleanupErrors[0],
    });
  }
};

const mergeRunAndCleanupErrors = (runError, cleanupError) => {
  if (!runError) {
    return cleanupError;
  }

  return new Error(`${runError.message}\nCleanup also failed: ${cleanupError.message}`, {
    cause: runError,
  });
};

export const remainingCourseTimeoutMs = ({ deadlineAt, label, timeoutMs }) => {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw new Error(`${label} exceeded the per-course timeout before Playwright started.`);
  }
  if (remainingMs < timeoutMs) {
    console.log(`[e2e-matrix] ${label} has ${remainingMs} ms remaining after pre-run cleanup.`);
  }
  return remainingMs;
};

export const runCourse = async (
  course,
  {
    root = projectRoot,
    configPath = suiteConfigPath,
    baseEnv = process.env,
    timeoutMs = parseCourseTimeoutMs(baseEnv),
    runNpmFn = runNpm,
    cleanupWorktreeDevProcessesFn = cleanupWorktreeDevProcesses,
    waitForPortClosedFn = waitForPortClosed,
    activeChildren,
    log = console.log,
  } = {},
) => {
  const { env: sourceEnv, sourceLabel } = resolveCourseEnv(course, baseEnv, root);
  const env = { ...sourceEnv };
  env.E2E_PORT = String(await resolveMatrixE2ePort(env));
  env.COURSE_DOCS_NEXT_DIST_DIR = createIsolatedNextDistDir(`playwright-${course.name}`);
  const suiteConfig = resolveCourseSuiteConfig(env.COURSE_CONTENT_SOURCE);
  const label = `${course.name} (${sourceLabel}, E2E_PORT=${env.E2E_PORT}, timeout=${timeoutMs} ms)`;
  const deadlineAt = Date.now() + timeoutMs;

  log(`\n=== Running E2E for ${label} ===`);
  log(
    `[e2e-matrix] cleanup before course=${course.name} source=${sourceLabel} port=${env.E2E_PORT}`,
  );
  await cleanupCourseState({
    root,
    configPath,
    port: env.E2E_PORT,
    cleanupWorktreeDevProcessesFn,
    waitForPortClosedFn,
  });

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(suiteConfig, null, 2)}\n`, "utf8");

  let runError;
  try {
    await runNpmFn({
      args: ["run", "test:e2e"],
      env,
      label,
      timeoutMs: remainingCourseTimeoutMs({ deadlineAt, label, timeoutMs }),
      cwd: root,
      activeChildren,
    });
  } catch (error) {
    runError = error;
  }

  try {
    log(
      `[e2e-matrix] cleanup after course=${course.name} source=${sourceLabel} port=${env.E2E_PORT}`,
    );
    await cleanupCourseState({
      root,
      configPath,
      port: env.E2E_PORT,
      cleanupWorktreeDevProcessesFn,
      waitForPortClosedFn,
    });
  } catch (cleanupError) {
    runError = mergeRunAndCleanupErrors(runError, cleanupError);
  }

  if (runError) {
    console.error(`[e2e-matrix] ${label} failed: ${runError.message}`);
    throw runError;
  }

  log(`=== Completed E2E for ${label} ===`);
};

export const runMatrix = async ({
  matrixCourses = courses,
  root = projectRoot,
  configPath = suiteConfigPath,
  baseEnv = process.env,
  timeoutMs = parseCourseTimeoutMs(baseEnv),
  runNpmFn = runNpm,
  cleanupWorktreeDevProcessesFn = cleanupWorktreeDevProcesses,
  waitForPortClosedFn = waitForPortClosed,
  activeChildren,
} = {}) => {
  for (const course of matrixCourses) {
    await runCourse(course, {
      root,
      configPath,
      baseEnv,
      timeoutMs,
      runNpmFn,
      cleanupWorktreeDevProcessesFn,
      waitForPortClosedFn,
      activeChildren,
    });
  }
};

const signalExitCode = (signal) => {
  if (signal === "SIGINT") {
    return 130;
  }
  if (signal === "SIGTERM") {
    return 143;
  }
  return 1;
};

const installProcessExitCleanup = ({ activeChildren }) => {
  const cleanupSuiteConfigForExit = () => {
    try {
      removeSuiteConfig();
    } catch (error) {
      console.error(`[e2e-matrix] ${error.message}`);
    }
  };

  const handleSignal = async (signal) => {
    console.error(`[e2e-matrix] Received ${signal}; cleaning up matrix state before exit.`);
    cleanupSuiteConfigForExit();
    const results = await Promise.allSettled(
      [...activeChildren].map((child) => killProcessTree(child)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          `[e2e-matrix] Failed to stop child process tree: ${messageFrom(result.reason)}`,
        );
      }
    }
    try {
      cleanupWorktreeDevProcesses({ projectRoot, timeoutSeconds: CLEANUP_TIMEOUT_SECONDS });
    } catch (error) {
      console.error(`[e2e-matrix] Worktree process cleanup failed: ${error.message}`);
    }
    process.exit(signalExitCode(signal));
  };

  const signalListeners = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const listener = () => handleSignal(signal);
    signalListeners.set(signal, listener);
    process.once(signal, listener);
  }

  process.once("exit", cleanupSuiteConfigForExit);

  return () => {
    process.removeListener("exit", cleanupSuiteConfigForExit);
    for (const [signal, listener] of signalListeners) {
      process.removeListener(signal, listener);
    }
  };
};

const runCli = async () => {
  loadEnvDefaults();
  const activeChildren = new Set();
  const uninstallExitCleanup = installProcessExitCleanup({ activeChildren });
  try {
    await runMatrix({ activeChildren });
  } finally {
    uninstallExitCleanup();
    removeSuiteConfig();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCli();
  } catch (error) {
    console.error(`[e2e-matrix] ${error.message}`);
    process.exitCode = 1;
  }
}

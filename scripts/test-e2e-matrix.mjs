import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { formatContentSource, parseContentSource } from "./content-source.mjs";

const require = createRequire(import.meta.url);
const { resolveCourseSuiteConfig } = require("../tests/e2e/course-defaults.cjs");

const projectRoot = process.cwd();
const suiteConfigPath = path.join(projectRoot, "tests", "e2e", ".suite-config.json");

const courses = [
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
];

const run = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });

const runNpm = async (args, env) => {
  if (process.platform === "win32") {
    await run("cmd.exe", ["/d", "/s", "/c", "npm", ...args], env);
    return;
  }
  await run("npm", args, env);
};

const readEnvFile = (filename) => {
  const envPath = path.join(projectRoot, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return dotenv.parse(fs.readFileSync(envPath, "utf8"));
  } catch {
    return {};
  }
};

const loadEnvDefaults = () => {
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

const resolveCourseEnv = (course) => {
  const env = { ...process.env };
  const sourceText = process.env[course.sourceEnv]?.trim() || course.defaultSource;
  const source = parseContentSource(sourceText);

  if (source.kind === "local") {
    const localPath = path.resolve(projectRoot, source.localDir);
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

loadEnvDefaults();

for (const course of courses) {
  const { env: sourceEnv, sourceLabel } = resolveCourseEnv(course);
  const env = { ...sourceEnv };
  const suiteConfig = resolveCourseSuiteConfig(env.COURSE_CONTENT_SOURCE);

  console.log(`\n=== Running E2E for ${course.name} (${sourceLabel}) ===`);

  fs.mkdirSync(path.dirname(suiteConfigPath), { recursive: true });
  fs.writeFileSync(suiteConfigPath, `${JSON.stringify(suiteConfig, null, 2)}\n`, "utf8");

  try {
    await runNpm(["run", "test:e2e"], env);
  } finally {
    try {
      fs.unlinkSync(suiteConfigPath);
    } catch {
      // ignore
    }
  }
}

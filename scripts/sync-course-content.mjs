import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { getRequiredContentSourceText, parseContentSource } from "./content-source.mjs";
import { resolveNextDistDirPath } from "./next-dist-dir.mjs";

const projectRoot = process.cwd();
const envFileRoot = path.resolve(projectRoot, process.env.COURSE_DOCS_ENV_FILE_DIR ?? ".");
const workRoot = path.join(projectRoot, ".course-content");
const cloneDir = path.join(workRoot, "repo");
const sourceStatePath = path.join(workRoot, "active-source.txt");

const readEnv = (filename) => {
  const envPath = path.join(envFileRoot, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return dotenv.parse(fs.readFileSync(envPath));
  } catch {
    return {};
  }
};

// Env precedence:
// - process.env (explicit) wins
// - later files override earlier files
const explicitEnvKeys = new Set(Object.keys(process.env));
const fileEnv = {
  ...readEnv(".env"),
  ...readEnv(".env.local"),
  ...readEnv(".env.course"),
  ...readEnv(".env.course.local"),
};
for (const [key, value] of Object.entries(fileEnv)) {
  if (!explicitEnvKeys.has(key)) {
    process.env[key] = value;
  }
}

const nextDistDirPath = resolveNextDistDirPath({ projectRoot, env: process.env });
const skipNextDistClear = process.env.COURSE_DOCS_SKIP_NEXT_DIST_CLEAR === "1";

const courseSourceText = getRequiredContentSourceText(process.env);
const courseSource = parseContentSource(courseSourceText);
const gitCommand = process.env.COURSE_DOCS_GIT_COMMAND || "git";
const gitCommandPrefix = process.env.COURSE_DOCS_GIT_SCRIPT
  ? [process.env.COURSE_DOCS_GIT_SCRIPT]
  : [];

const runGit = (args, options = {}) =>
  spawnSync(gitCommand, [...gitCommandPrefix, ...args], options);

const requiredPaths = [
  { label: "content", rel: "content" },
  { label: "site.config.ts", rel: "site.config.ts" },
];

const run = (command, args) => {
  const result =
    command === gitCommand
      ? runGit(args, { stdio: "inherit" })
      : spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
};

const runCapture = (command, args) => {
  const result =
    command === gitCommand
      ? runGit(args, { encoding: "utf8" })
      : spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
  return result.stdout ?? "";
};

const rmIfExists = (targetPath) => {
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
      return;
    }
  } catch {
    // ignore
  }
  fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
};

const readTextIfExists = (p) => {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
};

const writeTextFile = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const ensureRealDirectory = (dirPath) => {
  try {
    const st = fs.lstatSync(dirPath);
    if (!st.isDirectory() || st.isSymbolicLink()) {
      rmIfExists(dirPath);
    }
  } catch {
    // ignore
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

const normalizeRelativePath = (relativePath) => relativePath.split(path.sep).join("/");

const copyFile = (from, to) => {
  try {
    const st = fs.lstatSync(to);
    if (st.isDirectory() || st.isSymbolicLink()) {
      rmIfExists(to);
    }
  } catch {
    // ignore
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

const mirrorPath = (from, to, options) => {
  const st = fs.lstatSync(from);

  if (st.isSymbolicLink()) {
    const resolved = fs.realpathSync(from);
    const resolvedStat = fs.statSync(resolved);
    if (resolvedStat.isDirectory()) {
      mirrorDir(resolved, to, { ...options, rootFrom: options.rootFrom ?? from });
      return;
    }
    if (resolvedStat.isFile()) {
      copyFile(resolved, to);
      return;
    }
    throw new Error(`Unsupported symlink target in content repo: ${from}`);
  }

  if (st.isDirectory()) {
    mirrorDir(from, to, { ...options, rootFrom: options.rootFrom ?? from });
    return;
  }

  if (st.isFile()) {
    copyFile(from, to);
    return;
  }

  throw new Error(`Unsupported filesystem entry in content repo: ${from}`);
};

const mirrorDir = (from, to, options = {}) => {
  const { shouldSkip } = options;
  const rootFrom = options.rootFrom ?? from;
  ensureRealDirectory(to);

  const sourceEntries = fs.readdirSync(from, { withFileTypes: true });
  const keptNames = new Set();

  for (const entry of sourceEntries) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootFrom, sourcePath));

    if (shouldSkip?.({ name: entry.name, sourcePath, targetPath, relativePath })) {
      continue;
    }
    keptNames.add(entry.name);
  }

  for (const entry of fs.readdirSync(to, { withFileTypes: true })) {
    if (entry.name === ".keep") {
      continue;
    }
    if (!keptNames.has(entry.name)) {
      rmIfExists(path.join(to, entry.name));
    }
  }

  for (const entry of sourceEntries) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootFrom, sourcePath));

    if (shouldSkip?.({ name: entry.name, sourcePath, targetPath, relativePath })) {
      continue;
    }

    mirrorPath(sourcePath, targetPath, { rootFrom, shouldSkip });
  }
};

const syncDirectory = ({ from, to, shouldSkip }) => {
  if (!fs.existsSync(from)) {
    rmIfExists(to);
    ensureRealDirectory(to);
    fs.writeFileSync(path.join(to, ".keep"), "");
    return;
  }

  mirrorDir(from, to, { shouldSkip });
  fs.writeFileSync(path.join(to, ".keep"), "");
};

const resolveRemoteHeadSha = ({ repoUrl, ref }) => {
  const stdout = runCapture(gitCommand, ["ls-remote", repoUrl, ref]);
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    throw new Error(`Unable to resolve remote ref ${ref} from ${repoUrl}`);
  }

  const [sha] = line.split(/\s+/u);
  if (!sha) {
    throw new Error(`Unable to parse remote ref ${ref} from ${repoUrl}`);
  }
  return sha;
};

const hasGitClone = (dirPath) => fs.existsSync(path.join(dirPath, ".git"));

let sourceRoot = cloneDir;
let activeSourceId = "";

const previousSourceId = readTextIfExists(sourceStatePath);

if (courseSource.kind === "local") {
  sourceRoot = path.resolve(projectRoot, courseSource.localDir);
  activeSourceId = `dir:${sourceRoot}`;
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`COURSE_CONTENT_SOURCE points to a non-directory path: ${sourceRoot}`);
  }
} else {
  fs.mkdirSync(workRoot, { recursive: true });
  const ghToken = process.env.GH_TOKEN?.trim();
  const repoUrl = ghToken
    ? `https://x-access-token:${ghToken}@github.com/${courseSource.repo}.git`
    : `https://github.com/${courseSource.repo}.git`;
  const headSha = resolveRemoteHeadSha({ repoUrl, ref: courseSource.ref });
  activeSourceId = `repo:${courseSource.repo}#${courseSource.ref}@${headSha}`;

  if (previousSourceId !== activeSourceId || !hasGitClone(cloneDir)) {
    rmIfExists(cloneDir);
    run(gitCommand, ["clone", "--depth", "1", "--branch", courseSource.ref, repoUrl, cloneDir]);
  }
}

if (!activeSourceId) {
  activeSourceId = sourceRoot ? `dir:${sourceRoot}` : "unknown";
}

if (!skipNextDistClear && previousSourceId && previousSourceId !== activeSourceId) {
  // Switching content can change the MDX tree and page-map.
  // Clear Next build artifacts to avoid cross-course stale runtime chunks.
  rmIfExists(nextDistDirPath);
}
writeTextFile(sourceStatePath, activeSourceId);

for (const required of requiredPaths) {
  const resolved = path.join(sourceRoot, required.rel);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing required path in content repo: ${required.label} (${required.rel})`);
  }
}

const contentFrom = path.join(sourceRoot, "content");
const contentTo = path.join(projectRoot, "content");
syncDirectory({
  from: contentFrom,
  to: contentTo,
  shouldSkip: ({ name }) => name === "_pagefind",
});

const siteConfigFrom = path.join(sourceRoot, "site.config.ts");
const siteConfigTo = path.join(projectRoot, "site.config.ts");
copyFile(siteConfigFrom, siteConfigTo);

const publicFrom = path.join(sourceRoot, "public");
const publicTo = path.join(projectRoot, "public");
syncDirectory({
  from: publicFrom,
  to: publicTo,
  shouldSkip: ({ relativePath }) => relativePath === "student-works",
});

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_NEXT_DIST_DIR = ".next";
export const TEST_NEXT_DIST_DIR = ".next-test";
export const GENERATED_NEXT_TSCONFIG_PREFIX = "tsconfig.next.generated";

const ROOT_TSCONFIG_NAME = "tsconfig.json";
const DEFAULT_NEXT_TYPES_INCLUDE = `${DEFAULT_NEXT_DIST_DIR}/types/**/*.ts`;
const GENERATED_TSCONFIG_EXCLUDE = ["node_modules"];

const toPortablePath = (value) => value.split(path.sep).join("/");

const readRootTsconfig = (projectRoot) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, ROOT_TSCONFIG_NAME), "utf8"));

const hasCustomNextTypesInclude = (include) =>
  typeof include === "string" &&
  include.startsWith(".next") &&
  include.endsWith("/types/**/*.ts") &&
  include !== DEFAULT_NEXT_TYPES_INCLUDE;

const createSafeFileSegment = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "") || "custom";

const unique = (values) => [...new Set(values)];

const createGeneratedTsconfig = ({ projectRoot, distDir }) => {
  const rootTsconfig = readRootTsconfig(projectRoot);
  const rootInclude = Array.isArray(rootTsconfig.include) ? rootTsconfig.include : [];
  const inheritedInclude = rootInclude
    .filter((include) => !hasCustomNextTypesInclude(include))
    .map((include) => toPortablePath(include));
  const customTypesInclude = `${distDir}/types/**/*.ts`;
  const include = unique([...inheritedInclude, customTypesInclude]);
  const exclude = Array.isArray(rootTsconfig.exclude)
    ? rootTsconfig.exclude.map((exclude) => toPortablePath(exclude))
    : GENERATED_TSCONFIG_EXCLUDE;

  return `${JSON.stringify(
    {
      extends: `./${ROOT_TSCONFIG_NAME}`,
      include,
      exclude,
    },
    null,
    2,
  )}\n`;
};

const writeFileIfChanged = (filePath, contents) => {
  try {
    if (fs.readFileSync(filePath, "utf8") === contents) {
      return;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  fs.writeFileSync(filePath, contents);
};

export const resolveNextDistDir = ({ projectRoot, env = process.env }) => {
  const configured = env.COURSE_DOCS_NEXT_DIST_DIR?.trim() || DEFAULT_NEXT_DIST_DIR;

  if (path.isAbsolute(configured)) {
    throw new Error("COURSE_DOCS_NEXT_DIST_DIR must be a project-relative path.");
  }

  const resolved = path.resolve(projectRoot, configured);
  const relative = path.relative(projectRoot, resolved);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("COURSE_DOCS_NEXT_DIST_DIR must stay within the project root.");
  }

  return toPortablePath(relative);
};

export const resolveNextDistDirPath = ({ projectRoot, env = process.env }) =>
  path.resolve(projectRoot, resolveNextDistDir({ projectRoot, env }));

export const isCustomNextDistDir = ({ projectRoot, env = process.env }) =>
  resolveNextDistDir({ projectRoot, env }) !== DEFAULT_NEXT_DIST_DIR;

export const resolveNextTsconfigPath = ({ projectRoot, env = process.env }) => {
  const distDir = resolveNextDistDir({ projectRoot, env });
  if (distDir === DEFAULT_NEXT_DIST_DIR) {
    return ROOT_TSCONFIG_NAME;
  }

  const distDirSegment = createSafeFileSegment(distDir.replaceAll("/", "-"));
  return `${GENERATED_NEXT_TSCONFIG_PREFIX}.${distDirSegment}.json`;
};

export const ensureNextTsconfig = ({ projectRoot, env = process.env }) => {
  const distDir = resolveNextDistDir({ projectRoot, env });
  const tsconfigPath = resolveNextTsconfigPath({ projectRoot, env });

  if (distDir === DEFAULT_NEXT_DIST_DIR) {
    return tsconfigPath;
  }

  const generatedPath = path.join(projectRoot, tsconfigPath);
  writeFileIfChanged(generatedPath, createGeneratedTsconfig({ projectRoot, distDir }));

  return tsconfigPath;
};

export const createIsolatedNextDistDir = (scope) => {
  if (!String(scope ?? "").trim()) {
    throw new Error("A non-empty scope is required to create an isolated Next dist dir.");
  }

  const safeScope = String(scope)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (!safeScope || safeScope === "." || safeScope === "..") {
    throw new Error("The isolated Next dist dir scope must contain a safe path segment.");
  }

  return `${TEST_NEXT_DIST_DIR}/${safeScope}`;
};

import path from "node:path";

export const DEFAULT_NEXT_DIST_DIR = ".next";
export const TEST_NEXT_DIST_DIR = ".next-test";

const toPortablePath = (value) => value.split(path.sep).join("/");

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

export const createIsolatedNextDistDir = (scope) => {
  if (!String(scope ?? "").trim()) {
    throw new Error("A non-empty scope is required to create an isolated Next dist dir.");
  }

  // Keep one dedicated test dist dir so Next's typed-route include path stays stable.
  return TEST_NEXT_DIST_DIR;
};


import path from 'node:path';

export const DEFAULT_NEXT_DIST_DIR = '.next';

export const resolveNextDistDir = ({
  env = process.env,
  projectRoot,
}: {
  env?: NodeJS.ProcessEnv;
  projectRoot: string;
}) => {
  const configured = env.COURSE_DOCS_NEXT_DIST_DIR?.trim() || DEFAULT_NEXT_DIST_DIR;

  if (path.isAbsolute(configured)) {
    throw new Error('COURSE_DOCS_NEXT_DIST_DIR must be a project-relative path.');
  }

  const resolved = path.resolve(projectRoot, configured);
  const relative = path.relative(projectRoot, resolved);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('COURSE_DOCS_NEXT_DIST_DIR must stay within the project root.');
  }

  return relative;
};

export const resolveNextDistDirPath = ({
  env = process.env,
  projectRoot,
}: {
  env?: NodeJS.ProcessEnv;
  projectRoot: string;
}) => path.resolve(projectRoot, resolveNextDistDir({ env, projectRoot }));

import { createIsolatedNextDistDir, DEFAULT_NEXT_DIST_DIR } from "../scripts/next-dist-dir.mjs";

export const createRunDevTestEnv = ({ label, env = process.env, overrides = {} }) => ({
  ...env,
  NEXT_TELEMETRY_DISABLED: "1",
  COURSE_DOCS_NEXT_DIST_DIR: createIsolatedNextDistDir(label),
  ...overrides,
});

export const createPlaywrightWebServerEnv = ({ label, env = process.env, overrides = {} }) => ({
  ...env,
  COURSE_DOCS_NEXT_DIST_DIR: env.COURSE_DOCS_NEXT_DIST_DIR ?? createIsolatedNextDistDir(label),
  ...overrides,
});

export { DEFAULT_NEXT_DIST_DIR };

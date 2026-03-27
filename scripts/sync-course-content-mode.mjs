const getLocalSourceModeOverride = (env) => {
  const rawMode =
    typeof env.COURSE_DOCS_LOCAL_SOURCE_MODE === 'string'
      ? env.COURSE_DOCS_LOCAL_SOURCE_MODE.trim().toLowerCase()
      : '';

  if (rawMode === 'copy') {
    return false;
  }
  if (rawMode === 'link') {
    return true;
  }
  return null;
};

export const shouldLinkLocalSource = ({ projectRoot, env }) => {
  const normalizedProjectRoot = projectRoot.replace(/\\/g, '/');
  if (env.VERCEL || env.VERCEL_ENV) {
    return false;
  }
  if (normalizedProjectRoot.startsWith('/vercel/path')) {
    return false;
  }

  const modeOverride = getLocalSourceModeOverride(env);
  if (modeOverride !== null) {
    return modeOverride;
  }

  return true;
};

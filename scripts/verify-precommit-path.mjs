const findPathKey = (env) => Object.keys(env).find((key) => key.toLowerCase() === "path");

export const normalizePathEntries = (value, platform = process.platform) => {
  if (typeof value !== "string") return value;

  const delimiter = platform === "win32" ? ";" : ":";
  const seen = new Set();
  return value
    .split(delimiter)
    .filter((entry) => {
      const key = platform === "win32" ? entry.toLowerCase() : entry;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(delimiter);
};

export const normalizeNpmPathEnv = (env, platform = process.platform) => {
  const pathKey = findPathKey(env);
  if (!pathKey) return { ...env };

  return { ...env, [pathKey]: normalizePathEntries(env[pathKey], platform) };
};

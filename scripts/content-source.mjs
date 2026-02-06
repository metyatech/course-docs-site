export const DEFAULT_GITHUB_REF = 'main';
export const DEFAULT_COURSE_CONTENT_SOURCE =
  'github:metyatech/javascript-course-docs#master';

const isLocalPathLike = (value) =>
  value.startsWith('.') ||
  value.startsWith('/') ||
  value.startsWith('\\') ||
  /^[a-zA-Z]:[\\/]/.test(value);

export const parseContentSource = (rawValue) => {
  const value = rawValue.trim();
  if (!value) {
    throw new Error('Content source must not be empty');
  }

  if (isLocalPathLike(value)) {
    return { kind: 'local', localDir: value };
  }

  if (!value.startsWith('github:')) {
    throw new Error(
      `Invalid content source: "${value}". Use "github:owner/repo#ref" or a local path.`
    );
  }

  const githubValue = value.slice('github:'.length).trim();
  const [repoPart, refPart] = githubValue.split('#', 2);
  const repo = repoPart?.trim();
  const ref = refPart?.trim() || DEFAULT_GITHUB_REF;

  if (!repo || !repo.includes('/')) {
    throw new Error(
      `Invalid GitHub source "${value}". Expected format: github:owner/repo#ref`
    );
  }

  return { kind: 'remote', repo, ref };
};

export const formatContentSource = (source) => {
  if (source.kind === 'local') {
    return source.localDir;
  }
  return `github:${source.repo}#${source.ref}`;
};

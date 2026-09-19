const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const STATIC_ASSET_LIKE_EXTENSIONS = [
  // Archives
  '7z',
  'bz2',
  'gz',
  'rar',
  'tar',
  'tgz',
  'xz',
  'zip',

  // Audio
  'aac',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'opus',
  'wav',

  // Data / documents
  'csv',
  'json',
  'pdf',
  'txt',
  'xml',
  'yaml',
  'yml',

  // Fonts
  'otf',
  'ttf',
  'woff',
  'woff2',

  // Images
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',

  // Video
  'mkv',
  'mov',
  'mp4',
  'webm',

  // Web assets (note: not md/mdx)
  'css',
  'htm',
  'html',
  'js',
  'map',
] as const;

const IMPORTABLE_STATIC_ASSET_EXTENSION_NAMES = [
  // Archives
  '7z',
  'bz2',
  'gz',
  'rar',
  'tar',
  'tgz',
  'xz',
  'zip',

  // Audio
  'aac',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'opus',
  'wav',

  // Data / documents
  'csv',
  'htm',
  'html',
  'pdf',
  'txt',
  'xml',
  'yaml',
  'yml',

  // Fonts
  'otf',
  'ttf',
  'woff',
  'woff2',

  // Images
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',

  // Video
  'mkv',
  'mov',
  'mp4',
  'webm',
] as const;

export const IMPORTABLE_STATIC_ASSET_EXTENSIONS = IMPORTABLE_STATIC_ASSET_EXTENSION_NAMES.map(
  (extension) => `.${extension}`,
);

const DOWNLOAD_ROUTE_ASSET_EXTENSION_NAMES = [
  '7z',
  'bz2',
  'csv',
  'gz',
  'htm',
  'html',
  'pdf',
  'rar',
  'tar',
  'tgz',
  'txt',
  'xml',
  'xz',
  'yaml',
  'yml',
  'zip',
] as const;

export const DOWNLOAD_ROUTE_ASSET_EXTENSIONS = DOWNLOAD_ROUTE_ASSET_EXTENSION_NAMES.map(
  (extension) => `.${extension}`,
);

const COURSE_ASSET_CONTENT_TYPES: Record<string, string> = {
  '.7z': 'application/x-7z-compressed',
  '.aac': 'audio/aac',
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.bz2': 'application/x-bzip2',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.map': 'application/json; charset=utf-8',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.rar': 'application/vnd.rar',
  '.svg': 'image/svg+xml',
  '.tar': 'application/x-tar',
  '.tgz': 'application/gzip',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.xz': 'application/x-xz',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.zip': 'application/zip',
};

export const STATIC_ASSET_LIKE_EXTENSION_SET = new Set<string>(STATIC_ASSET_LIKE_EXTENSIONS);
export const IMPORTABLE_STATIC_ASSET_EXTENSION_SET = new Set<string>(
  IMPORTABLE_STATIC_ASSET_EXTENSIONS,
);
export const DOWNLOAD_ROUTE_ASSET_EXTENSION_SET = new Set<string>(DOWNLOAD_ROUTE_ASSET_EXTENSIONS);

export const DEPLOYMENT_EXCLUDED_CONTENT_DIRECTORIES = [
  'docs/css-basics/css-styling-basics/assets/css-styling-basics-complete',
  'docs/html-basics/images-links/assets/images-links-complete',
  'docs/html-basics/practice-exercises/markup-exercises-advanced/assets/markup-exercises-advanced-complete',
  'docs/html-basics/text-markup/assets/text-markup-complete',
] as const;

const DEPLOYMENT_EXCLUDED_CONTENT_FILE_PATTERNS = [
  /^docs\/student-guide\/shots\/[^/]+\.raw\.png$/i,
  /^docs\/student-guide\/shots\/[^/]+\.shot\.json$/i,
];

export const isDeploymentExcludedCourseContentPath = (relativePath: string) => {
  const normalizedPath = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  return (
    DEPLOYMENT_EXCLUDED_CONTENT_FILE_PATTERNS.some((pattern) => pattern.test(normalizedPath)) ||
    DEPLOYMENT_EXCLUDED_CONTENT_DIRECTORIES.some(
      (directoryPath) =>
        normalizedPath === directoryPath || normalizedPath.startsWith(`${directoryPath}/`),
    )
  );
};

const NON_PUBLISHABLE_SOURCE_EXTENSIONS = new Set(['.md', '.mdx']);
const SENSITIVE_FILE_EXTENSIONS = new Set(['.key', '.p12', '.pem', '.pfx']);

/**
 * Determines whether a relative path under `content/` can be published as a
 * direct static asset. Unknown extensions are publishable by default; source,
 * hidden, sensitive, and authoring-only paths are excluded.
 */
export const isPublishableCourseAssetPath = (relativePath: string) => {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath.replaceAll('\\', '/'));
  } catch {
    return false;
  }

  const segments = decodedPath.replace(/^\/+/, '').split('/');
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'),
    )
  ) {
    return false;
  }

  const filename = segments.at(-1) ?? '';
  const extension = filename.includes('.') ? `.${filename.split('.').at(-1)!.toLowerCase()}` : '';
  if (
    /^_meta\.(?:ts|js|mjs|cjs)$/i.test(filename) ||
    NON_PUBLISHABLE_SOURCE_EXTENSIONS.has(extension) ||
    SENSITIVE_FILE_EXTENSIONS.has(extension) ||
    /\.raw\.png$/i.test(filename) ||
    /\.shot\.json$/i.test(filename) ||
    isDeploymentExcludedCourseContentPath(decodedPath)
  ) {
    return false;
  }

  return true;
};

/** Returns the static-asset rewrite destination for a course URL, if eligible. */
export const getCourseAssetRewritePath = (pathname: string) => {
  if (
    !pathname.startsWith('/docs/') &&
    !pathname.startsWith('/layout-preview/') &&
    !pathname.startsWith('/submissions/')
  ) {
    return undefined;
  }

  const lastSlash = pathname.lastIndexOf('/');
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot <= lastSlash || lastDot === pathname.length - 1) {
    return undefined;
  }

  if (!isPublishableCourseAssetPath(pathname.replace(/^\/+/, ''))) {
    return undefined;
  }

  return `/_course-assets${pathname}`;
};

export const createAssetExtensionRegex = (extensions: readonly string[]) =>
  new RegExp(
    `\\.(${extensions.map((extension) => escapeRegExp(extension.slice(1))).join('|')})$`,
    'i',
  );

export const getCourseAssetContentType = (extension: string) =>
  COURSE_ASSET_CONTENT_TYPES[extension.toLowerCase()] ?? 'application/octet-stream';

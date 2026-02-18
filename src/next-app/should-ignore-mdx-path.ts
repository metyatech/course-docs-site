const STATIC_ASSET_EXTENSIONS = new Set([
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
]);

const isStaticAssetLike = (segment: string) => {
  const dotIndex = segment.lastIndexOf('.');
  if (dotIndex <= 0) {
    return false;
  }

  const extension = segment.slice(dotIndex + 1).toLowerCase();
  return STATIC_ASSET_EXTENSIONS.has(extension);
};

export const shouldIgnoreMdxPath = (mdxPath: string[] | undefined) => {
  if (!mdxPath || mdxPath.length === 0) {
    return true;
  }

  if (mdxPath[0] === '_next') {
    return true;
  }

  return isStaticAssetLike(mdxPath[mdxPath.length - 1] ?? '');
};

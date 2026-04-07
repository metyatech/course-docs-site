import { STATIC_ASSET_LIKE_EXTENSION_SET } from '../shared/course-asset-config.js';

const isStaticAssetLike = (segment: string) => {
  const dotIndex = segment.lastIndexOf('.');
  if (dotIndex <= 0) {
    return false;
  }

  const extension = segment.slice(dotIndex + 1).toLowerCase();
  return STATIC_ASSET_LIKE_EXTENSION_SET.has(extension);
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

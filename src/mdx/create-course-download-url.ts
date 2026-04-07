const DOWNLOAD_ROUTE_PATH = '/download-asset/';

export const createCourseDownloadUrl = (assetUrl: string, filename: string) => {
  const normalizedAssetUrl = typeof assetUrl === 'string' ? assetUrl.trim() : '';
  const normalizedFilename = typeof filename === 'string' ? filename.trim() : '';

  if (!normalizedAssetUrl.startsWith('/') || normalizedFilename.length === 0) {
    return normalizedAssetUrl;
  }

  const params = new URLSearchParams({
    src: normalizedAssetUrl,
    filename: normalizedFilename,
  });

  return `${DOWNLOAD_ROUTE_PATH}?${params.toString()}`;
};

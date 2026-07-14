import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import {
  DOWNLOAD_ROUTE_ASSET_EXTENSION_SET,
  getCourseAssetContentType,
} from '../shared/course-asset-config.js';

export const runtime = 'nodejs';

const contentRoot = path.join(process.cwd(), 'content');

const isDownloadExtension = (ext: string) => DOWNLOAD_ROUTE_ASSET_EXTENSION_SET.has(ext);

const safeDecodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const allowedRoots = new Set(['docs', 'exams', 'layout-preview', 'submissions']);

export const GET = async (
  request: Request,
  context: { params: Promise<{ assetPath: string[] }> },
) => {
  const { assetPath } = await context.params;

  if (!assetPath?.length || !allowedRoots.has(assetPath[0] ?? '')) {
    return new Response('Not Found', { status: 404 });
  }

  const decodedSegments = assetPath.map((segment) => safeDecodeSegment(segment));
  const relativeAssetPath = decodedSegments.join(path.sep);
  const resolvedPath = path.resolve(contentRoot, relativeAssetPath);

  const rel = path.relative(contentRoot, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return new Response('Not Found', { status: 404 });
  }

  let fileStat;
  try {
    fileStat = await stat(resolvedPath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  if (!fileStat.isFile()) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const headers = new Headers();
  headers.set('Content-Type', getCourseAssetContentType(ext));
  const etag = `"${fileStat.size}-${fileStat.mtimeMs}"`;
  headers.set('ETag', etag);
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers });
  }

  if (isDownloadExtension(ext)) {
    const filename = path.basename(resolvedPath);
    headers.set(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
  }

  const stream = createReadStream(resolvedPath);
  const body = Readable.toWeb(stream) as ReadableStream;
  return new Response(body, { status: 200, headers });
};

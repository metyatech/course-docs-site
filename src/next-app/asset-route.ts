import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

export const runtime = 'nodejs';

const contentRoot = path.join(process.cwd(), 'content');

const getContentType = (ext: string) => {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.pdf':
      return 'application/pdf';
    case '.zip':
      return 'application/zip';
    case '.html':
      return 'text/html; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
};

const isDownloadExtension = (ext: string) =>
  ext === '.zip' || ext === '.pdf' || ext === '.html' || ext === '.txt';

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
  headers.set('Content-Type', getContentType(ext));
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

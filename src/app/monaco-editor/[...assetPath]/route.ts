import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';

const monacoRoot = path.join(process.cwd(), 'node_modules', 'monaco-editor');

const getContentType = (ext: string) => {
  switch (ext) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.ttf':
      return 'font/ttf';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
};

const safeDecodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export const GET = async (
  request: Request,
  context: { params: Promise<{ assetPath: string[] }> }
) => {
  const { assetPath } = await context.params;
  if (!assetPath?.length) {
    return new Response('Not Found', { status: 404 });
  }

  const decodedSegments = assetPath.map((segment) => safeDecodeSegment(segment));
  const resolvedPath = path.resolve(monacoRoot, decodedSegments.join(path.sep));
  const relativePath = path.relative(monacoRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
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

  const stream = createReadStream(resolvedPath);
  const body = Readable.toWeb(stream) as ReadableStream;
  return new Response(body, { status: 200, headers });
};

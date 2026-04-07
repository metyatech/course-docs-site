const DOWNLOADABLE_PREFIXES = ['/_next/static/media/', '/asset/'];

const buildContentDisposition = (filename: string) => {
  const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

const isAllowedDownloadSource = (pathname: string) =>
  DOWNLOADABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

export const runtime = 'nodejs';

export const GET = async (request: Request) => {
  const requestUrl = new URL(request.url);
  const src = requestUrl.searchParams.get('src')?.trim() ?? '';
  const filename = requestUrl.searchParams.get('filename')?.trim() ?? '';

  if (src.length === 0 || filename.length === 0) {
    return new Response('Bad Request', { status: 400 });
  }

  const sourceUrl = new URL(src, requestUrl);
  if (sourceUrl.origin !== requestUrl.origin || !isAllowedDownloadSource(sourceUrl.pathname)) {
    return new Response('Not Found', { status: 404 });
  }

  const upstreamResponse = await fetch(sourceUrl, {
    headers: request.headers.get('if-none-match')
      ? {
          'if-none-match': request.headers.get('if-none-match') ?? '',
        }
      : undefined,
  });

  if (upstreamResponse.status === 304) {
    const headers = new Headers();
    const etag = upstreamResponse.headers.get('etag');
    if (etag) {
      headers.set('ETag', etag);
    }
    headers.set('Content-Disposition', buildContentDisposition(filename));
    return new Response(null, { status: 304, headers });
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return new Response('Not Found', { status: upstreamResponse.status === 404 ? 404 : 502 });
  }

  const headers = new Headers();
  const contentType = upstreamResponse.headers.get('content-type');
  const cacheControl = upstreamResponse.headers.get('cache-control');
  const etag = upstreamResponse.headers.get('etag');

  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  if (cacheControl) {
    headers.set('Cache-Control', cacheControl);
  }
  if (etag) {
    headers.set('ETag', etag);
  }

  headers.set('Content-Disposition', buildContentDisposition(filename));

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
};

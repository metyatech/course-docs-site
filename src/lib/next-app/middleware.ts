import { NextResponse, type NextRequest } from 'next/server';
import { DIRECT_ROUTE_ASSET_EXTENSION_SET } from '../shared/course-asset-config';

export type AssetMiddlewareRequest = NextRequest;

const getExtension = (pathname: string) => {
  const lastSlash = pathname.lastIndexOf('/');
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot === -1) return '';
  if (lastSlash !== -1 && lastDot < lastSlash) return '';
  return pathname.slice(lastDot).toLowerCase();
};

/**
 * Rewrites direct asset requests under /docs, /exams, /layout-preview,
 * /submissions to the dedicated /asset/* route handler so that file
 * requests inside course content are served consistently.
 *
 * This is the local successor of the previous Platform middleware.
 * Exposed as a pure function so the layout-level middleware in
 * `src/middleware.ts` can compose it with the admin session gate.
 */
export const rewriteAssetRequests = (request: AssetMiddlewareRequest) => {
  const { pathname } = request.nextUrl;

  if (
    !pathname.startsWith('/docs/') &&
    !pathname.startsWith('/exams/') &&
    !pathname.startsWith('/layout-preview/') &&
    !pathname.startsWith('/submissions/')
  ) {
    return NextResponse.next();
  }

  const ext = getExtension(pathname);
  if (!ext || ext === '.md' || ext === '.mdx') {
    return NextResponse.next();
  }

  if (!DIRECT_ROUTE_ASSET_EXTENSION_SET.has(ext)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/asset${pathname}`;
  return NextResponse.rewrite(url);
};

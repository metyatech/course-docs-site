import { NextResponse, type NextRequest } from 'next/server';

const assetExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.css',
  '.js',
  '.json',
  '.txt',
  '.pdf',
  '.zip',
  '.html',
]);

const getExtension = (pathname: string) => {
  const lastSlash = pathname.lastIndexOf('/');
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot === -1) return '';
  if (lastSlash !== -1 && lastDot < lastSlash) return '';
  return pathname.slice(lastDot).toLowerCase();
};

export function middleware(request: NextRequest) {
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

  if (!assetExtensions.has(ext)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/asset${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/docs/:path*', '/exams/:path*', '/layout-preview/:path*', '/submissions/:path*'],
};

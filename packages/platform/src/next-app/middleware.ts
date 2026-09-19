import { NextResponse, type NextRequest } from 'next/server';
import { getCourseAssetRewritePath } from '../shared/course-asset-config.js';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const rewritePath = getCourseAssetRewritePath(pathname);
  if (!rewritePath) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = rewritePath;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/docs/:path*', '/layout-preview/:path*', '/submissions/:path*'],
};

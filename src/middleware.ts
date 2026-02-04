import { middleware as platformMiddleware } from '@metyatech/course-docs-platform/next-app/middleware';

export const config = {
  matcher: [
    '/docs/:path*',
    '/exams/:path*',
    '/layout-preview/:path*',
    '/submissions/:path*',
  ],
};
export function middleware(request: Parameters<typeof platformMiddleware>[0]) {
  return platformMiddleware(request);
}


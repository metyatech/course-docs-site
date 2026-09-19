import { middleware as rewriteAssetRequests } from "@metyatech/course-docs-platform/next-app/middleware";

export const config = {
  matcher: ["/docs/:path*", "/layout-preview/:path*", "/submissions/:path*"],
};

export function middleware(request: Parameters<typeof rewriteAssetRequests>[0]) {
  return rewriteAssetRequests(request);
}

import { NextResponse } from "next/server";
import { isProtectedRoute } from "./lib/admin-mode";
import { isAdminSessionValid } from "./lib/admin/session";
import { rewriteAssetRequests, type AssetMiddlewareRequest } from "./lib/next-app/middleware";

export const config = {
  matcher: ["/docs/:path*", "/exams/:path*", "/layout-preview/:path*", "/submissions/:path*"],
};

export async function middleware(request: AssetMiddlewareRequest) {
  if (isProtectedRoute(request.nextUrl.pathname)) {
    const secret = (process.env.ADMIN_MODE_TOKEN ?? '').trim();
    const enabled = await isAdminSessionValid(
      request.cookies.get('course-docs-admin-session')?.value,
      secret,
    );

    if (!enabled) {
      const url = request.nextUrl.clone();
      url.pathname = process.env.NEXT_PUBLIC_ADMIN_FALLBACK_PATH ?? '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return rewriteAssetRequests(request);
}

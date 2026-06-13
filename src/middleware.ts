import { NextResponse } from "next/server";
import {
  isProtectedRoute,
  getAdminModeCookieName,
  getAdminModePublicFallbackPath,
  getAdminSessionSecret,
} from "./lib/admin-mode";
import { isAdminSessionValid } from "./lib/admin/session";
import { rewriteAssetRequests, type AssetMiddlewareRequest } from "./lib/next-app/middleware";

export const config = {
  matcher: ["/docs/:path*", "/exams/:path*", "/layout-preview/:path*", "/submissions/:path*"],
};

export async function middleware(request: AssetMiddlewareRequest) {
  if (isProtectedRoute(request.nextUrl.pathname)) {
    const secret = getAdminSessionSecret();
    const enabled = await isAdminSessionValid(
      request.cookies.get(getAdminModeCookieName())?.value,
      secret,
    );

    if (!enabled) {
      const url = request.nextUrl.clone();
      url.pathname = getAdminModePublicFallbackPath();
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return rewriteAssetRequests(request);
}

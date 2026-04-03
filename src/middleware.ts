import { NextResponse } from "next/server";
import { middleware as platformMiddleware } from "@metyatech/course-docs-platform/next-app/middleware";
import {
  getAdminModeCookieName,
  getAdminModePublicFallbackPath,
  isAdminModeConfigured,
  isAdminModeCookieEnabled,
  isProtectedRoute,
} from "./lib/admin-mode";

export const config = {
  matcher: ["/docs/:path*", "/exams/:path*", "/layout-preview/:path*", "/submissions/:path*"],
};
export function middleware(request: Parameters<typeof platformMiddleware>[0]) {
  if (isProtectedRoute(request.nextUrl.pathname)) {
    const enabled =
      isAdminModeConfigured() &&
      isAdminModeCookieEnabled(request.cookies.get(getAdminModeCookieName())?.value);

    if (!enabled) {
      const url = request.nextUrl.clone();
      url.pathname = getAdminModePublicFallbackPath();
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return platformMiddleware(request);
}

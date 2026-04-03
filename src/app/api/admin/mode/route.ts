import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getAdminModeCookieName,
  getAdminModeSecret,
  getAdminModePublicFallbackPath,
  getProtectedAdminLinks,
  hasProtectedAdminRoutes,
  isAdminModeConfigured,
  isAdminModeCookieEnabled,
} from "../../../../lib/admin-mode";

type AdminModeUnavailableReason = "missing-admin-mode-token" | "no-protected-links" | null;

const buildSetupHint = (reason: AdminModeUnavailableReason) => {
  switch (reason) {
    case "missing-admin-mode-token":
      return "この環境では ADMIN_MODE_TOKEN が未設定のため、管理者ページは開けません。.env.local に ADMIN_MODE_TOKEN を設定して npm run dev を再起動してください。";
    case "no-protected-links":
      return "このサイトでは管理者向けの制限ページは設定されていません。";
    default:
      return null;
  }
};

const buildStatusPayload = (cookieEnabled: boolean) => {
  const protectedLinks = getProtectedAdminLinks();
  const tokenConfigured = Boolean(getAdminModeSecret());
  const hasProtectedLinks = hasProtectedAdminRoutes();
  const configured = hasProtectedLinks && tokenConfigured;
  const unavailableReason: AdminModeUnavailableReason = !hasProtectedLinks
    ? "no-protected-links"
    : tokenConfigured
      ? null
      : "missing-admin-mode-token";

  return {
    configured,
    enabled: configured && cookieEnabled,
    protectedLinks,
    publicFallbackPath: getAdminModePublicFallbackPath(),
    tokenConfigured,
    unavailableReason,
    setupHint: buildSetupHint(unavailableReason),
  };
};

export async function GET() {
  const cookieStore = await cookies();
  const enabled = isAdminModeCookieEnabled(cookieStore.get(getAdminModeCookieName())?.value);
  return NextResponse.json(buildStatusPayload(enabled));
}

export async function POST(request: Request) {
  if (!isAdminModeConfigured()) {
    return NextResponse.json(buildStatusPayload(false));
  }

  const payload = (await request.json().catch(() => ({}))) as { token?: string };
  const token = payload.token?.trim() ?? "";

  if (!token || token !== getAdminModeSecret()) {
    return NextResponse.json(buildStatusPayload(false), { status: 401 });
  }

  const response = NextResponse.json(buildStatusPayload(true));
  response.cookies.set({
    name: getAdminModeCookieName(),
    value: "1",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json(buildStatusPayload(false));
  response.cookies.set({
    name: getAdminModeCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

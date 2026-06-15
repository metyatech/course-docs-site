import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getAdminModeCookieName,
  getAdminModePublicFallbackPath,
  getProtectedAdminLinks,
  hasAdminCommentModeration,
  hasProtectedAdminRoutes,
  hasAnyAdminCapability,
  isAdminModeConfigured,
  isAdminSessionValid,
  getAdminModeToken,
  getAdminSessionSecret,
  areAdminSecretsDistinct,
} from "../../../../lib/admin-mode";
import {
  getAdminSessionTtlSeconds,
  isAdminSessionSecretValid,
  signAdminSession,
} from "../../../../lib/admin/session";
import { constantTimeSecretEqual } from "../../../../lib/admin/timing";
import { isSameOriginMutation } from "../../../../lib/admin/same-origin";

const NO_STORE = "no-store";

type UnavailableReason =
  | "no-admin-capability"
  | "missing-admin-mode-token"
  | "missing-admin-session-secret"
  | "invalid-admin-session-secret"
  | "admin-token-must-differ-from-session-secret"
  | null;

type AdminModeStatus = {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  capabilities: {
    protectedDocs: boolean;
    commentModeration: boolean;
  };
  protectedLinks: Array<{ href: string; label: string }>;
  publicFallbackPath: string;
  tokenConfigured: boolean;
  sessionSecretConfigured: boolean;
  sessionSecretValid: boolean;
  secretsDistinct: boolean;
  unavailableReason: UnavailableReason;
  setupHint: string | null;
};

const setupHintFor = (reason: UnavailableReason) => {
  switch (reason) {
    case "no-admin-capability":
      return "このサイトでは管理者向け機能が有効化されていません。";
    case "missing-admin-mode-token":
      return "ADMIN_MODE_TOKEN が未設定です。.env.local に ADMIN_MODE_TOKEN を設定して再起動してください。";
    case "missing-admin-session-secret":
      return "ADMIN_SESSION_SECRET が未設定です。.env.local に ADMIN_SESSION_SECRET を設定して再起動してください。";
    case "invalid-admin-session-secret":
      return "ADMIN_SESSION_SECRET は UTF-8 で32バイト以上のランダム値にしてください。";
    case "admin-token-must-differ-from-session-secret":
      return "ADMIN_MODE_TOKEN と ADMIN_SESSION_SECRET には異なる値を設定してください。";
    default:
      return null;
  }
};

const jsonResponse = (status: AdminModeStatus, init: ResponseInit = {}) => {
  const response = NextResponse.json(status, init);
  response.headers.set("Cache-Control", NO_STORE);
  return response;
};

const buildStatus = (enabled: boolean): AdminModeStatus => {
  const protectedLinks = getProtectedAdminLinks();
  const protectedDocs = hasProtectedAdminRoutes();
  const commentModeration = hasAdminCommentModeration();
  const tokenConfigured = getAdminModeToken() !== "";
  const sessionSecretConfigured = getAdminSessionSecret() !== "";
  const sessionSecretValid = isAdminSessionSecretValid(getAdminSessionSecret());
  const capability = protectedDocs || commentModeration;

  const secretsDistinct =
    tokenConfigured &&
    sessionSecretValid &&
    areAdminSecretsDistinct();

  const unavailableReason: UnavailableReason = !capability
    ? "no-admin-capability"
    : !tokenConfigured
      ? "missing-admin-mode-token"
      : !sessionSecretConfigured
        ? "missing-admin-session-secret"
        : !sessionSecretValid
          ? "invalid-admin-session-secret"
          : !areAdminSecretsDistinct()
            ? "admin-token-must-differ-from-session-secret"
            : null;

  const configured = unavailableReason === null;
  return {
    available: capability,
    configured,
    enabled: configured && enabled,
    capabilities: { protectedDocs, commentModeration },
    protectedLinks,
    publicFallbackPath: getAdminModePublicFallbackPath(),
    tokenConfigured,
    sessionSecretConfigured,
    sessionSecretValid,
    secretsDistinct,
    unavailableReason,
    setupHint: setupHintFor(unavailableReason),
  };
};

export async function GET() {
  const cookieStore = await cookies();
  const enabled = await isAdminSessionValid(cookieStore.get(getAdminModeCookieName())?.value);
  return jsonResponse(buildStatus(enabled));
}

export async function POST(request: Request) {
  if (!hasAnyAdminCapability()) {
    return jsonResponse(buildStatus(false), { status: 503 });
  }

  if (!isAdminModeConfigured()) {
    return jsonResponse(buildStatus(false), { status: 503 });
  }

  if (!isSameOriginMutation(request)) {
    return jsonResponse(buildStatus(false), { status: 403 });
  }

  // Content-Length check
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return jsonResponse(buildStatus(false), { status: 413 });
  }

  // Parse JSON
  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096) {
      return jsonResponse(buildStatus(false), { status: 413 });
    }
    payload = text ? JSON.parse(text) : {};
  } catch {
    return jsonResponse(buildStatus(false), { status: 400 });
  }

  const tokenRaw = (payload as { token?: unknown })?.token;
  if (typeof tokenRaw !== "string") {
    return jsonResponse(buildStatus(false), { status: 400 });
  }
  const token = tokenRaw.trim();
  if (!token) {
    return jsonResponse(buildStatus(false), { status: 400 });
  }
  if (token.length > 256) {
    return jsonResponse(buildStatus(false), { status: 400 });
  }

  const adminToken = getAdminModeToken();
  const match = await constantTimeSecretEqual(token, adminToken);
  if (!match) {
    return jsonResponse(buildStatus(false), { status: 401 });
  }

  const secret = getAdminSessionSecret();
  const signed = await signAdminSession(secret);
  const response = jsonResponse(buildStatus(true));
  response.cookies.set({
    name: getAdminModeCookieName(),
    value: signed,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getAdminSessionTtlSeconds(),
  });
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return jsonResponse(buildStatus(false), { status: 403 });
  }
  const response = jsonResponse(buildStatus(false));
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

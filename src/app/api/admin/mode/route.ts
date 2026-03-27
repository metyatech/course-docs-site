import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  getAdminModeCookieName,
  getAdminModeSecret,
  getAdminModePublicFallbackPath,
  getProtectedAdminLinks,
  isAdminModeConfigured,
  isAdminModeCookieEnabled,
} from '../../../../lib/admin-mode';

const buildStatusPayload = (enabled: boolean) => ({
  configured: isAdminModeConfigured(),
  enabled,
  protectedLinks: getProtectedAdminLinks(),
  publicFallbackPath: getAdminModePublicFallbackPath(),
});

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
  const token = payload.token?.trim() ?? '';

  if (!token || token !== getAdminModeSecret()) {
    return NextResponse.json(buildStatusPayload(false), { status: 401 });
  }

  const response = NextResponse.json(buildStatusPayload(true));
  response.cookies.set({
    name: getAdminModeCookieName(),
    value: '1',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json(buildStatusPayload(false));
  response.cookies.set({
    name: getAdminModeCookieName(),
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

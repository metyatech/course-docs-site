import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SESSION_COOKIE_NAME = 'course-docs-admin-session';
const SESSION_SECRET_MIN_BYTES = 32;
const SESSION_MAX_BYTES = 2048;
const SESSION_VERSION = 1;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_MAX_CLOCK_SKEW_SECONDS = 60;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const getAdminSupabase = () => {
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
};

const isSameOriginMutation = (request: Request) => {
  const origin = request.headers.get('origin');
  const secFetchSite = request.headers.get('sec-fetch-site');

  if (origin) {
    try {
      const requestUrl = new URL(request.url);
      const originUrl = new URL(origin);
      if (requestUrl.origin !== originUrl.origin) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (secFetchSite) {
    return new Set(['same-origin', 'same-site', 'none']).has(secFetchSite.toLowerCase());
  }

  return true;
};

const getCookieValue = (request: Request, name: string) => {
  const cookie = request.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      return rawValue.join('=');
    }
  }
  return undefined;
};

const decodeBase64Url = (input: string) => {
  if (!input) {
    return null;
  }
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
};

const signSessionBody = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(body)));
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
};

const isSessionSecretValid = (secret: string) =>
  textEncoder.encode(secret).byteLength >= SESSION_SECRET_MIN_BYTES;

const isAdminSessionValid = async (value: string | undefined) => {
  const secret = (process.env.ADMIN_SESSION_SECRET ?? '').trim();
  if (!value || !isSessionSecretValid(secret) || value.length > SESSION_MAX_BYTES) {
    return false;
  }

  const separator = value.indexOf('.');
  if (
    separator <= 0 ||
    separator === value.length - 1 ||
    value.indexOf('.', separator + 1) !== -1
  ) {
    return false;
  }

  const body = value.slice(0, separator);
  const actualSignature = decodeBase64Url(value.slice(separator + 1));
  if (!actualSignature) {
    return false;
  }

  const expectedSignature = await signSessionBody(secret, body);
  if (!timingSafeEqual(actualSignature, expectedSignature)) {
    return false;
  }

  const bodyBytes = decodeBase64Url(body);
  if (!bodyBytes) {
    return false;
  }

  let payload: { v?: unknown; iat?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(textDecoder.decode(bodyBytes)) as {
      v?: unknown;
      iat?: unknown;
      exp?: unknown;
    };
  } catch {
    return false;
  }

  if (
    payload.v !== SESSION_VERSION ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp)
  ) {
    return false;
  }

  const issuedAt = payload.iat as number;
  const expiresAt = payload.exp as number;
  const now = Math.floor(Date.now() / 1000);
  return (
    issuedAt <= now + SESSION_MAX_CLOCK_SKEW_SECONDS &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= SESSION_TTL_SECONDS &&
    expiresAt > now
  );
};

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const resolvedParams = await context.params;
  const commentId = resolvedParams.id;

  if (!(await isAdminSessionValid(getCookieValue(request, SESSION_COOKIE_NAME)))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getAdminSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const { error } = await supabase.from('work_comments').delete().eq('id', commentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

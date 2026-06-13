/**
 * Admin session cookie using Web Crypto (SubtleCrypto).
 *
 * Replaces the previous trivially-forgeable `cookie === "1"` check.
 * The cookie value is `<base64url(payload)>.<base64url(hmacSha256(payload, key))>`.
 * The payload is `{ v: 1, exp: <unix-seconds> }`. The HMAC key is derived
 * directly from `ADMIN_MODE_TOKEN` to avoid introducing a new env var.
 *
 * Compatible with Edge Middleware (uses SubtleCrypto only, never Node `crypto`).
 */
const COOKIE_VERSION = 1 as const;
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let str = '';
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(bytes[i]);
  }
  const b64 = typeof btoa === 'function' ? btoa(str) : Buffer.from(str, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (input: string): Uint8Array | null => {
  if (typeof input !== 'string' || input.length === 0) return null;
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  try {
    const binary = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

const importKey = async (secret: string): Promise<CryptoKey> => {
  const keyBytes = enc.encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
};

const signBytes = async (key: CryptoKey, message: string): Promise<Uint8Array> => {
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(signature);
};

const constantTimeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
};

export type AdminSessionPayload = {
  v: 1;
  iat: number;
  exp: number;
};

export type SignOptions = {
  ttlSeconds?: number;
  now?: number;
};

export const getAdminSessionTtlSeconds = () => DEFAULT_TTL_SECONDS;

export const getAdminSessionSecret = (): string => (process.env.ADMIN_MODE_TOKEN ?? '').trim();

export const isAdminSessionConfigured = (): boolean => getAdminSessionSecret() !== '';

export const signAdminSession = async (secret: string, options: SignOptions = {}): Promise<string> => {
  if (!secret) {
    throw new Error('Admin session secret is not configured');
  }
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = { v: COOKIE_VERSION, iat: now, exp: now + ttl };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(enc.encode(payloadJson));
  const key = await importKey(secret);
  const sig = await signBytes(key, payloadB64);
  return `${payloadB64}.${toBase64Url(sig)}`;
};

export type VerifyResult =
  | { ok: true; payload: AdminSessionPayload }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad-version' | 'bad-signature' | 'expired' };

export const verifyAdminSession = async (
  value: string | undefined | null,
  secret: string,
  options: { now?: number } = {},
): Promise<VerifyResult> => {
  if (!value || typeof value !== 'string') return { ok: false, reason: 'missing' };
  if (!secret) return { ok: false, reason: 'missing' };
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === value.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const body = value.slice(0, lastDot);
  const sigB64 = value.slice(lastDot + 1);
  const sigBytes = fromBase64Url(sigB64);
  if (!sigBytes) return { ok: false, reason: 'malformed' };
  const key = await importKey(secret);
  const expectedSig = await signBytes(key, body);
  if (!constantTimeEqual(sigBytes, expectedSig)) {
    return { ok: false, reason: 'bad-signature' };
  }
  const bodyBytes = fromBase64Url(body);
  if (!bodyBytes) return { ok: false, reason: 'malformed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(bodyBytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'malformed' };
  }
  const candidate = parsed as Partial<AdminSessionPayload>;
  if (candidate.v !== COOKIE_VERSION) {
    return { ok: false, reason: 'bad-version' };
  }
  if (typeof candidate.exp !== 'number' || !Number.isFinite(candidate.exp)) {
    return { ok: false, reason: 'malformed' };
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (candidate.exp <= now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload: candidate as AdminSessionPayload };
};

export const isAdminSessionValid = async (
  value: string | undefined | null,
  secret: string,
  options?: { now?: number },
): Promise<boolean> => (await verifyAdminSession(value, secret, options)).ok;

export const getAdminSessionCookieName = (): string => 'course-docs-admin-session';

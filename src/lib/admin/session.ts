/**
 * Admin session cookie using Web Crypto (SubtleCrypto).
 *
 * Replaces the previous trivially-forgeable `cookie === "1"` check.
 * The cookie value is `<base64url(payload)>.<base64url(hmacSha256(payload, key))>`.
 * The payload is `{ v: 1, iat: <unix-seconds>, exp: <unix-seconds> }`. The HMAC
 * key is derived directly from `ADMIN_SESSION_SECRET`.
 *
 * Compatible with Edge Middleware (uses SubtleCrypto only, never Node `crypto`).
 */
const COOKIE_VERSION = 1 as const;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_COOKIE_LENGTH = 2048;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let str = "";
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === "function" ? btoa(str) : Buffer.from(str, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (input: string): Uint8Array | null => {
  if (typeof input !== "string" || input.length === 0) return null;
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  try {
    const binary =
      typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

const importKey = async (secret: string): Promise<CryptoKey> => {
  const keyBytes = enc.encode(secret);
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
};

const signBytes = async (key: CryptoKey, message: string): Promise<Uint8Array> => {
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
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
  now?: number;
};

export const getAdminSessionTtlSeconds = () => SESSION_TTL_SECONDS;

export const getAdminSessionSecret = (): string => (process.env.ADMIN_SESSION_SECRET ?? "").trim();

const MIN_SESSION_SECRET_BYTES = 32;
export const isAdminSessionSecretValid = (secret = getAdminSessionSecret()): boolean =>
  enc.encode(secret).byteLength >= MIN_SESSION_SECRET_BYTES;

export const isAdminSessionConfigured = (): boolean => isAdminSessionSecretValid();

export const signAdminSession = async (
  secret: string,
  options: SignOptions = {},
): Promise<string> => {
  if (!isAdminSessionSecretValid(secret)) {
    throw new Error("Admin session secret must be at least 32 UTF-8 bytes");
  }
  // The session TTL is fixed at SESSION_TTL_SECONDS (8 hours). There is no
  // public `ttlSeconds` option. `now` is accepted only for deterministic
  // test fixtures; no production call site should pass it.
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    v: COOKIE_VERSION,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(enc.encode(payloadJson));
  const key = await importKey(secret);
  const sig = await signBytes(key, payloadB64);
  return `${payloadB64}.${toBase64Url(sig)}`;
};

export type VerifyResult =
  | { ok: true; payload: AdminSessionPayload }
  | {
      ok: false;
      reason:
        | "missing"
        | "invalid-secret"
        | "malformed"
        | "bad-version"
        | "bad-signature"
        | "expired";
    };

export const verifyAdminSession = async (
  value: string | undefined | null,
  secret: string,
  options: { now?: number } = {},
): Promise<VerifyResult> => {
  if (!value || typeof value !== "string") return { ok: false, reason: "missing" };

  if (!isAdminSessionSecretValid(secret)) {
    return { ok: false, reason: "invalid-secret" };
  }
  if (!secret) return { ok: false, reason: "missing" };
  if (value.length > MAX_COOKIE_LENGTH) return { ok: false, reason: "malformed" };

  // Strictly enforce a single '.' separator: no `lastIndexOf` trick that would
  // accept two or more dots, no leading-dot, no trailing-dot values.
  const firstDot = value.indexOf(".");
  if (firstDot <= 0 || firstDot === value.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  if (value.indexOf(".", firstDot + 1) !== -1) {
    return { ok: false, reason: "malformed" };
  }

  const body = value.slice(0, firstDot);
  const sigB64 = value.slice(firstDot + 1);

  const sigBytes = fromBase64Url(sigB64);
  if (!sigBytes) return { ok: false, reason: "malformed" };

  const key = await importKey(secret);
  const expectedSig = await signBytes(key, body);
  if (!constantTimeEqual(sigBytes, expectedSig)) {
    return { ok: false, reason: "bad-signature" };
  }

  const bodyBytes = fromBase64Url(body);
  if (!bodyBytes) return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(bodyBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "malformed" };
  }
  const candidate = parsed as Partial<AdminSessionPayload>;
  if (candidate.v !== COOKIE_VERSION) {
    return { ok: false, reason: "bad-version" };
  }
  if (!Number.isInteger(candidate.iat)) {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isInteger(candidate.exp)) {
    return { ok: false, reason: "malformed" };
  }
  const iat = candidate.iat as number;
  const exp = candidate.exp as number;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (iat > now + MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "malformed" };
  }
  if (exp <= iat) {
    return { ok: false, reason: "malformed" };
  }
  if (exp - iat > SESSION_TTL_SECONDS) {
    return { ok: false, reason: "malformed" };
  }
  if (exp <= now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload: { v: COOKIE_VERSION, iat, exp } };
};

export const isAdminSessionValid = async (
  value: string | undefined | null,
  secret: string,
  options?: { now?: number },
): Promise<boolean> => (await verifyAdminSession(value, secret, options)).ok;

export const getAdminSessionCookieName = (): string => "course-docs-admin-session";

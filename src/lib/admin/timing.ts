/**
 * Constant-time comparison helpers for secret material.
 *
 * `constantTimeSecretEqual` hashes both inputs with SHA-256 and compares the
 * fixed 32-byte digests, so the runtime cost does not depend on the secret
 * length and the comparison walks every byte of the digests in constant time.
 *
 * Use this for comparing the user-supplied admin token against
 * `ADMIN_SESSION_SECRET` (or any other secret) on every request, to avoid
 * timing-side-channel leaks of the secret's prefix length or content.
 */
/**
 * Compare two secret strings in length-independent constant time.
 *
 * Returns `false` when either argument is not a string, when the SHA-256
 * digests are different lengths, or when any byte of the two digests
 * differs. The comparison never short-circuits on the input string length
 * and never short-circuits partway through the digest bytes.
 */
export const constantTimeSecretEqual = async (a: string, b: string): Promise<boolean> => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ua = new Uint8Array(da);
  const ub = new Uint8Array(db);
  if (ua.length !== ub.length) return false;
  let diff = 0;
  for (let i = 0; i < ua.length; i += 1) diff |= ua[i] ^ ub[i];
  return diff === 0;
};

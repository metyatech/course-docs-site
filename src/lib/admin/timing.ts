/**
 * Constant-time string comparison helpers.
 *
 * Use these whenever the input is a secret (token, signature bytes) and
 * the comparison runs on every request, to avoid timing-side-channel
 * leaks of the secret's prefix length or content.
 *
 * Both functions run in O(min(a.length, b.length)) and return false
 * immediately if the lengths differ. The length-leak is generally
 * acceptable because the secret length is usually not sensitive and
 * the comparison time is bounded by the shorter of the two.
 */
export const constantTimeStringEqual = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const constantTimeBytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
};

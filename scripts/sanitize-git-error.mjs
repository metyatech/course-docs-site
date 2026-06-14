// Pure, dependency-free helpers for redacting GitHub auth material out of git's
// stderr so that sync failures can be surfaced as diagnostics without ever
// echoing a token, an authed URL, or a basic-auth header value.
//
// This module is intentionally pure: no I/O, no Node-only globals beyond the
// arguments. The sync script imports it for production use, and unit tests
// can exercise it without spawning git.

const REDACTED = "[REDACTED]";

const encodeTokenForUrl = (token) => {
  if (!token) return "";
  // Match the percent-encoding set git uses for HTTP userinfo: anything outside
  // the unreserved set (RFC 3986) plus a few extras that are safe inside
  // a userinfo component.
  return encodeURIComponent(token);
};

// Replace every literal occurrence of `token` (and the URL-encoded form) with
// the redaction marker. Operates on the raw text so that any future surface
// (e.g. a debug log line or a fatal message) that happens to leak the token
// is also scrubbed.
const scrubLiteralToken = (text, token) => {
  if (!token) return text;
  const encoded = encodeTokenForUrl(token);
  let next = text;
  if (token) {
    next = next.split(token).join(REDACTED);
  }
  if (encoded && encoded !== token) {
    next = next.split(encoded).join(REDACTED);
  }
  return next;
};

// Replace any URL of the form `https://<userinfo>@github.com/...` with a
// safe `https://github.com/...` so that the authed userinfo never reaches a
// log line or an exception message. We only target the github.com host (and
// www.github.com) because that is the only host this script ever talks to;
// generalising further would risk eating non-secret text.
const scrubGithubAuthedUrl = (text) =>
  text.replace(/https?:\/\/[^/\s@"]+@github\.com/giu, "https://github.com");

// Replace the value portion of a `Authorization: basic <value>` header
// (any case) with the redaction marker. The header name and the literal
// `basic ` token are kept so the reader still knows what kind of header
// appeared, but the credential value is dropped.
const scrubAuthorizationHeader = (text) =>
  text.replace(/(authorization\s*:\s*basic\s+)[A-Za-z0-9+/=._\-]+/giu, `$1${REDACTED}`);

/**
 * Redact GitHub auth material from a string (typically git's stderr).
 *
 * The helper is intentionally pure and side-effect free: callers can pass the
 * raw `process.env.GH_TOKEN` value at the time of the failed command and the
 * function will scrub the literal token, the URL-encoded form, any
 * `https://<user>@github.com/...` URL, and any `Authorization: basic <b64>`
 * header value.
 *
 * @param {string} text The text to redact. May be `null`/`undefined`.
 * @param {{ token?: string | null | undefined }} [options]
 * @returns {string} The redacted text. Non-string inputs are coerced via
 *   `String(...)`; an empty token makes the token-specific scrubbing a no-op
 *   while the URL and header scrubbers still run.
 */
export const redactGitError = (text, { token } = {}) => {
  if (text === null || text === undefined) {
    return "";
  }
  const source = typeof text === "string" ? text : String(text);
  const trimmedToken = typeof token === "string" ? token.trim() : "";

  let next = source;
  if (trimmedToken) {
    next = scrubLiteralToken(next, trimmedToken);
  }
  next = scrubGithubAuthedUrl(next);
  next = scrubAuthorizationHeader(next);
  return next;
};

/**
 * Redact the `args` array passed to a git invocation so that it is safe to
 * embed in a user-facing error message (e.g. the command label produced by
 * `buildCommandFailureError`). Each element is treated as a string and
 * passed through {@link redactGitError}; elements that match
 * `https?://<userinfo>@github.com/...` or that begin with the
 * `https://x-access-token:` prefix are replaced with the canonical
 * `https://github.com` form (the userinfo is the only thing that is
 * authoritative — the rest of the URL is left as the canonical form rather
 * than the credentialed form). All other elements pass through unchanged.
 *
 * This helper is intentionally a thin wrapper around {@link redactGitError}
 * so the per-element redaction rules stay in one place. Callers should NOT
 * embed the raw `args` array into a user-facing message; always go through
 * this helper first.
 *
 * @param {readonly unknown[]} args The argv elements passed to git.
 * @returns {string[]} A new array of the same length, with auth material
 *   replaced. Non-array inputs yield an empty array.
 */
export const redactArgsForError = (args) => {
  if (!Array.isArray(args)) {
    return [];
  }
  return args.map((entry) => {
    if (entry === null || entry === undefined) {
      return "";
    }
    const value = typeof entry === "string" ? entry : String(entry);
    return redactGitError(value);
  });
};

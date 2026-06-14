// Strict parser for `git ls-remote` stdout. The legacy parser took the
// first whitespace token of the first non-empty line and accepted ANY
// non-empty string as a SHA; the new parser enforces the actual Git
// object-id grammar (SHA-1 = 40 hex chars, SHA-256 = 64 hex chars) so
// that a malformed line can never be misread as a real object id.
//
// The parser is pure: no I/O, no Node-only globals beyond the input
// string. The sync script imports it for production use, and unit
// tests can exercise it without spawning git.
//
// The output of `parseLsRemoteObjectId` is one of three shapes:
//
//   - { kind: "ok", sha, ref } for a valid line
//   - { kind: "empty" } for empty / blank-only stdout
//   - { kind: "malformed", firstLine } for a non-empty stdout whose
//     first non-blank line is not "<hex>{40,64}\\s+<ref>"
//
// The `firstLine` field on the `malformed` shape is exposed for
// structured logging and tests; user-facing error messages MUST NOT
// embed it (it can carry attacker-controlled bytes that we have not
// validated).

// Regex matching the Git object-id grammar. We accept SHA-1 (40 hex
// chars, git's default since the project began) and SHA-256 (64 hex
// chars, used by hardened forks). Anything else — including short
// hashes, non-hex characters, or strings with no leading whitespace
// — is rejected.
const OBJECT_ID_LINE_PATTERN = /^(?<objectId>[0-9a-f]{40}|[0-9a-f]{64})\s+(?<ref>\S.*)$/iu;

/**
 * Parse `git ls-remote` stdout into a structured result.
 *
 * @param {string} rawStdout The raw stdout of `git ls-remote`. May
 *   include `\n` and `\r\n` line endings. May be `null` / `undefined`
 *   (coerced to empty string).
 * @returns {{ kind: "ok", sha: string, ref: string }
 *          | { kind: "empty" }
 *          | { kind: "malformed", firstLine: string }}
 */
export const parseLsRemoteObjectId = (rawStdout) => {
  const text =
    typeof rawStdout === "string" ? rawStdout : rawStdout == null ? "" : String(rawStdout);
  const lines = text.split(/\r?\n/u);
  // Find the first non-blank line. `git ls-remote` always emits at
  // least one line of "<sha>\t<ref>" per ref, followed by a trailing
  // blank line. An empty / blank-only stdout is the "no such ref"
  // case and is reported as `empty`.
  let firstLine = "";
  for (const entry of lines) {
    if (entry.trim().length > 0) {
      firstLine = entry;
      break;
    }
  }
  if (firstLine === "") {
    return { kind: "empty" };
  }
  const match = firstLine.match(OBJECT_ID_LINE_PATTERN);
  if (!match || !match.groups) {
    return { kind: "malformed", firstLine };
  }
  return { kind: "ok", sha: match.groups.objectId, ref: match.groups.ref };
};

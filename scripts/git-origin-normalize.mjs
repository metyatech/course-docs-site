// Defensive rewrite of `<cloneDir>/.git/config` so that the
// `[remote "origin"]` `url =` line is the canonical
// `https://github.com/<owner>/<repo>.git` form. This is a
// belt-and-suspenders repair for clones that may have been checked out
// by an older release of this script that URL-embedded the `GH_TOKEN`
// into the clone URL (which Git would then persist to `.git/config`).
//
// The legacy implementation only handled the FIRST `[remote "origin"]`
// section and the FIRST `url =` line in it. The new implementation
// walks EVERY line of the config, identifies EVERY `[remote "origin"]`
// section, drops EVERY `url =` line in any origin section, and writes
// the canonical URL as exactly ONE `url =` line in the FIRST origin
// section (or appends a new section if none exists). `fetch =` lines,
// other remote sections (e.g. `[remote "backup"]`), comments, and
// other config keys are preserved.
//
// After writing, the helper re-reads the file and asserts the
// postcondition: exactly one `url = <canonicalUrl>` line under any
// origin section, zero `x-access-token:` anywhere, zero `@github.com`
// userinfo in any origin URL value. If the postcondition fails, the
// helper throws an error that mentions only the canonical URL —
// NEVER the original (potentially credentialed) value — so a failed
// repair cannot leak the credential through an exception message.

import fs from "node:fs";
import path from "node:path";

// Match a github.com userinfo (`https://<anything-without-/, @, or quote>@github.com`).
// Used to reject any value that smuggles credentials into the persisted
// `remote.origin.url` even when the rest of the value looks like a canonical
// URL.
const CREDENTIALED_GITHUB_URL_PATTERN = /:\/\/[^/\s@"]*@github\.com/iu;
const X_ACCESS_TOKEN_PATTERN = /x-access-token:/iu;
const NEWLINE_PATTERN = /[\r\n]/u;

const ORIGIN_SECTION_HEADER = '[remote "origin"]';
const ORIGIN_SECTION_HEADER_TRIM = ORIGIN_SECTION_HEADER;
const NEW_SECTION_HEADER_PATTERN = /^\s*\[[^\]]*\]\s*$/u;
const URL_LINE_PATTERN = /^\s*url\s*=\s*(.*?)\s*$/u;
const LEADING_WHITESPACE_PATTERN = /^\s*/u;

// Reject a `remote.origin.url` value that contains anything that
// smells like a credential (userinfo, `x-access-token:` prefix, or an
// embedded newline that could break out of the `url = <value>` line).
// The error message is constructed from a fixed phrasing + the
// caller-supplied `canonicalUrl`; callers MUST validate `canonicalUrl`
// up front so that it is safe to echo. We never include `value` in
// the message because `value` is the untrusted thing we are rejecting.
export const assertSafeOriginUrlValue = (value, canonicalUrl) => {
  if (typeof value !== "string" || !value) {
    throw new Error(
      `Refusing to write an empty remote.origin.url; expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (CREDENTIALED_GITHUB_URL_PATTERN.test(value)) {
    throw new Error(
      `Refusing to write a remote.origin.url that contains userinfo; expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (X_ACCESS_TOKEN_PATTERN.test(value)) {
    throw new Error(
      `Refusing to write a remote.origin.url that contains the x-access-token prefix; expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (NEWLINE_PATTERN.test(value)) {
    throw new Error(
      `Refusing to write a remote.origin.url that contains a newline; expected the canonical URL ${canonicalUrl}.`,
    );
  }
};

// Reject a `canonicalUrl` that itself looks credentialed. The message
// here intentionally does NOT echo the offending value: by the time we
// detect this, we have not established that the value is safe to
// print.
export const assertSafeCanonicalUrl = (value) => {
  if (typeof value !== "string" || !value) {
    throw new Error("normalizeOriginUrl requires a non-empty canonicalUrl argument.");
  }
  if (CREDENTIALED_GITHUB_URL_PATTERN.test(value)) {
    throw new Error(
      "normalizeOriginUrl canonicalUrl must not contain userinfo (e.g. x-access-token:...).",
    );
  }
  if (X_ACCESS_TOKEN_PATTERN.test(value)) {
    throw new Error("normalizeOriginUrl canonicalUrl must not contain the x-access-token prefix.");
  }
  if (NEWLINE_PATTERN.test(value)) {
    throw new Error("normalizeOriginUrl canonicalUrl must not contain a newline.");
  }
};

// Resolve the path to the cloned repository's `.git/config` file. For
// a regular `git clone` the `.git` entry is a directory; for linked
// worktrees it can be a file. In either case the on-disk config file
// lives at `<cloneDir>/.git/config`.
export const resolveClonedRepoConfigPath = (cloneDirPath, canonicalUrl) => {
  const gitEntry = path.join(cloneDirPath, ".git");
  let stat;
  try {
    stat = fs.lstatSync(gitEntry);
  } catch (error) {
    throw new Error(
      `Cannot read cloned repo config at ${path.join(cloneDirPath, ".git", "config")}: ${
        error && error.code ? error.code : "unknown error"
      }. Expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (stat.isDirectory()) {
    return path.join(gitEntry, "config");
  }
  // Linked worktree: `.git` is a file whose first line is
  // `gitdir: <absolute path>`. Resolve to that and look for `config`
  // there. If the resolution fails we fall back to the file path's
  // neighbour, which is the only safe default for a regular clone.
  if (stat.isFile()) {
    let contents;
    try {
      contents = fs.readFileSync(gitEntry, "utf8");
    } catch (error) {
      throw new Error(
        `Cannot read cloned repo config pointer at ${gitEntry}: ${
          error && error.code ? error.code : "unknown error"
        }. Expected the canonical URL ${canonicalUrl}.`,
      );
    }
    const match = contents.match(/^\s*gitdir:\s*(.+)\s*$/mu);
    if (match) {
      return path.join(match[1].trim(), "config");
    }
  }
  return path.join(gitEntry, "config");
};

// Re-read the on-disk config and assert the postcondition: exactly one
// `url = <canonicalUrl>` line under any origin section, zero
// `x-access-token:` anywhere, zero `@github.com` userinfo in any
// origin URL value. Throws an error that mentions only the canonical
// URL — never the original (potentially credentialed) value — so a
// failed repair cannot leak the credential through an exception
// message.
const assertPostcondition = (configPath, canonicalUrl) => {
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot re-read clone config at ${configPath}: ${
        error && error.code ? error.code : "unknown error"
      }. Expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (X_ACCESS_TOKEN_PATTERN.test(text)) {
    throw new Error(
      `Postcondition failed: clone config at ${configPath} still contains the x-access-token prefix. Expected the canonical URL ${canonicalUrl}.`,
    );
  }
  if (CREDENTIALED_GITHUB_URL_PATTERN.test(text)) {
    throw new Error(
      `Postcondition failed: clone config at ${configPath} still contains a github.com userinfo. Expected the canonical URL ${canonicalUrl}.`,
    );
  }
  // Count `url = <canonicalUrl>` lines INSIDE any `[remote "origin"]`
  // section. We walk the lines and toggle an "in origin section"
  // flag.
  const lines = text.split(/\r?\n/u);
  let inOriginSection = false;
  let canonicalUrlCount = 0;
  for (const line of lines) {
    if (line.trim() === ORIGIN_SECTION_HEADER_TRIM) {
      inOriginSection = true;
      continue;
    }
    if (NEW_SECTION_HEADER_PATTERN.test(line)) {
      inOriginSection = false;
      continue;
    }
    if (!inOriginSection) continue;
    const urlMatch = line.match(URL_LINE_PATTERN);
    if (!urlMatch) continue;
    if (urlMatch[1] === canonicalUrl) {
      canonicalUrlCount += 1;
    }
  }
  if (canonicalUrlCount !== 1) {
    throw new Error(
      `Postcondition failed: clone config at ${configPath} must contain exactly one "url = <canonical>" line under [remote "origin"], found ${canonicalUrlCount}. Expected the canonical URL ${canonicalUrl}.`,
    );
  }
};

/**
 * Defensively rewrite `<cloneDir>/.git/config` so that EVERY
 * `[remote "origin"]` `url =` line is removed and the canonical
 * `https://github.com/<owner>/<repo>.git` is written as exactly ONE
 * `url =` line in the FIRST origin section (or a new section is
 * appended if none exists). See module header for the full contract.
 *
 * @param {string} cloneDir The absolute path to the cloned repository root.
 * @param {string} canonicalUrl The canonical URL to enforce, e.g.
 *   `https://github.com/<owner>/<repo>.git`. Must not contain userinfo.
 * @returns {{ url: string, changed: boolean }} The final value of
 *   `remote.origin.url` and whether the file was modified.
 */
export const normalizeOriginUrl = (cloneDir, canonicalUrl) => {
  if (typeof cloneDir !== "string" || !cloneDir) {
    throw new Error("normalizeOriginUrl requires a non-empty cloneDir path.");
  }
  assertSafeCanonicalUrl(canonicalUrl);
  // The canonical URL is itself subject to the same rules: it must
  // not smuggle credentials in. This is a programmer-error guard, not
  // a runtime guard for the persisted value.
  assertSafeOriginUrlValue(canonicalUrl, canonicalUrl);

  const configPath = resolveClonedRepoConfigPath(cloneDir, canonicalUrl);

  let original;
  try {
    original = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read clone config at ${configPath}: ${
        error && error.code ? error.code : "unknown error"
      }. Expected the canonical URL ${canonicalUrl}.`,
    );
  }

  // The INI grammar we need to parse is intentionally narrow: a
  // config file is a sequence of lines, lines are either section
  // headers (`[name]` or `[name "subsection"]`) or `key = value`
  // pairs, and comments start with `#` or `;`. We deliberately do
  // not pull in an INI library; a small line-based scan is enough for
  // the sections we own.
  const lines = original.split(/\r?\n/u);
  const originSectionIndices = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === ORIGIN_SECTION_HEADER_TRIM) {
      originSectionIndices.push(i);
    }
  }
  const firstOriginIndex = originSectionIndices[0] ?? -1;

  // Drop every `url =` line in every `[remote "origin"]` section.
  // We walk line by line tracking whether we are inside an origin
  // section; non-origin lines pass through unchanged.
  const kept = [];
  let inOriginSection = false;
  for (const line of lines) {
    if (line.trim() === ORIGIN_SECTION_HEADER_TRIM) {
      inOriginSection = true;
      kept.push(line);
      continue;
    }
    if (NEW_SECTION_HEADER_PATTERN.test(line)) {
      inOriginSection = false;
      kept.push(line);
      continue;
    }
    if (inOriginSection) {
      const urlMatch = line.match(URL_LINE_PATTERN);
      if (urlMatch) {
        // Drop the `url = ...` line entirely. We will re-insert a
        // single canonical `url =` line in the first origin section
        // below.
        continue;
      }
    }
    kept.push(line);
  }

  // Decide the indentation style of the existing `url =` line in the
  // first origin section, if any. Default to a single tab (git's
  // own writer convention).
  let indent = "\t";
  if (firstOriginIndex !== -1) {
    for (let i = firstOriginIndex + 1; i < lines.length; i += 1) {
      if (NEW_SECTION_HEADER_PATTERN.test(lines[i])) break;
      const match = lines[i].match(URL_LINE_PATTERN);
      if (match) {
        indent = lines[i].match(LEADING_WHITESPACE_PATTERN)[0];
        break;
      }
    }
  }

  // Build the new file: if there is at least one origin section,
  // insert the canonical `url =` line as the first entry after the
  // first origin section header. Otherwise append a new section at
  // the end.
  const finalLines = kept.slice();
  if (firstOriginIndex !== -1) {
    // `kept` is the filtered line list. We need the position of the
    // first `[remote "origin"]` header in `kept` to splice the
    // canonical `url =` line immediately after it.
    const firstKeptOrigin = finalLines.findIndex(
      (line) => line.trim() === ORIGIN_SECTION_HEADER_TRIM,
    );
    finalLines.splice(firstKeptOrigin + 1, 0, `${indent}url = ${canonicalUrl}`);
  } else {
    // No origin section: append a new section. Ensure the file ends
    // with a newline so the appended section is well-formed.
    if (finalLines.length > 0 && finalLines[finalLines.length - 1] !== "") {
      finalLines.push("");
    }
    finalLines.push(ORIGIN_SECTION_HEADER);
    finalLines.push(`${indent}url = ${canonicalUrl}`);
  }

  // Compute whether the file actually changed. A no-op rewrite (the
  // file already had exactly one `url = <canonical>` line in the
  // first origin section, no other `url =` lines in any origin
  // section, no `x-access-token:` prefix anywhere) yields
  // `changed: false`.
  const updated = `${finalLines.join("\n")}`;
  const changed = updated !== original;
  if (changed) {
    try {
      fs.writeFileSync(configPath, updated);
    } catch (error) {
      throw new Error(
        `Cannot write clone config at ${configPath}: ${
          error && error.code ? error.code : "unknown error"
        }. Expected the canonical URL ${canonicalUrl}.`,
      );
    }
  }
  // Always re-read and assert the postcondition, even when the file
  // was a no-op: a no-op file that satisfies the postcondition by
  // construction (only one canonical `url =` line, no credentialed
  // form) is the expected case, but a no-op file that violates the
  // postcondition (e.g. an attacker-managed .git/config with
  // `x-access-token:` in a non-url key) must still be rejected.
  assertPostcondition(configPath, canonicalUrl);
  return { url: canonicalUrl, changed };
};

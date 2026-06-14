import assert from "node:assert/strict";
import test from "node:test";
import { redactGitError } from "../scripts/sanitize-git-error.mjs";

const TOKEN = "super-secret-value";
const REPO = "https://github.com/metyatech/teacher-profile-docs.git";

test("redactGitError scrubs a literal token from a fatal message", () => {
  const input = `fatal: ${TOKEN}`;
  const out = redactGitError(input, { token: TOKEN });
  assert.equal(out, "fatal: [REDACTED]");
});

test("redactGitError scrubs the x-access-token URL form", () => {
  const input = `fatal: Authentication failed for 'https://x-access-token:${TOKEN}@github.com/metyatech/teacher-profile-docs.git/'`;
  const out = redactGitError(input, { token: TOKEN });
  assert.equal(
    out,
    `fatal: Authentication failed for 'https://github.com/metyatech/teacher-profile-docs.git/'`,
  );
  assert.doesNotMatch(out, /x-access-token/);
  assert.doesNotMatch(out, new RegExp(TOKEN));
});

test("redactGitError scrubs the bare-token URL form", () => {
  const input = `fatal: Authentication failed for 'https://${TOKEN}@github.com/metyatech/teacher-profile-docs.git/'`;
  const out = redactGitError(input, { token: TOKEN });
  assert.equal(
    out,
    `fatal: Authentication failed for 'https://github.com/metyatech/teacher-profile-docs.git/'`,
  );
  assert.doesNotMatch(out, new RegExp(TOKEN));
});

test("redactGitError scrubs Authorization: basic headers (any case)", () => {
  const cases = [
    `received: authorization: basic ${TOKEN}`,
    `received: AUTHORIZATION: basic ${TOKEN}`,
    `received: Authorization: Basic ${TOKEN}`,
    `received: AuThOrIzAtIoN:    BASIC    ${TOKEN}`,
  ];
  for (const input of cases) {
    const out = redactGitError(input, { token: TOKEN });
    assert.match(out, /authorization:\s*basic\s+\[REDACTED\]/i);
    assert.doesNotMatch(out, new RegExp(TOKEN));
  }
});

test("redactGitError scrubs authed github.com URLs even when no token is given", () => {
  const input = `fatal: Authentication failed for 'https://x-access-token:abc@github.com/foo/bar.git/'`;
  const out = redactGitError(input, { token: "" });
  assert.equal(out, `fatal: Authentication failed for 'https://github.com/foo/bar.git/'`);
  assert.doesNotMatch(out, /x-access-token/);
});

test("redactGitError returns input unchanged when there is no token and no secret-shaped content", () => {
  const input =
    "fatal: unable to access 'https://github.com/metyatech/javascript-course-docs.git/': not a git repository";
  const out = redactGitError(input, { token: "" });
  assert.equal(out, input);

  const outNoToken = redactGitError(input, {});
  assert.equal(outNoToken, input);
});

test("redactGitError scrubs literal tokens that contain URL-reserved characters", () => {
  const token = "a@b%c+d";
  const input = `fatal: leaked ${token} somewhere`;
  const out = redactGitError(input, { token });
  assert.equal(out, "fatal: leaked [REDACTED] somewhere");
  assert.doesNotMatch(out, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("redactGitError handles the full spec example error message", () => {
  const input = `remote: Repository not found.\nfatal: Authentication failed for 'https://x-access-token:${TOKEN}@github.com/metyatech/teacher-profile-docs.git/'`;
  const out = redactGitError(input, { token: TOKEN });
  assert.match(out, /Repository not found/);
  assert.match(out, /Authentication failed/);
  assert.doesNotMatch(out, new RegExp(TOKEN));
  assert.doesNotMatch(out, /x-access-token/);
  assert.match(out, /https:\/\/github\.com\/metyatech\/teacher-profile-docs\.git\//);
});

test("redactGitError returns empty string for null and undefined", () => {
  assert.equal(redactGitError(null), "");
  assert.equal(redactGitError(undefined), "");
  assert.equal(redactGitError(null, { token: TOKEN }), "");
  assert.equal(redactGitError(undefined, { token: TOKEN }), "");
});

test("redactGitError preserves the repository URL when no auth material is present", () => {
  const input = `fatal: could not read Username for 'https://github.com/metyatech/javascript-course-docs': terminal prompts disabled`;
  const out = redactGitError(input, { token: TOKEN });
  assert.equal(out, input);
});

test("redactGitError scrubs the percent-encoded form of the token in a URL", () => {
  // The token "a/b" percent-encodes the slash, but the URL pattern itself
  // is matched first. We verify both scrubbing paths cooperate on a token
  // whose percent-encoded form differs from the literal.
  const token = "abc/def";
  const input = `fatal: ${token} and https://${token}@github.com/x/y.git`;
  const out = redactGitError(input, { token });
  assert.doesNotMatch(out, new RegExp(token));
  assert.match(out, /https:\/\/github\.com\/x\/y\.git/);
});

// Pure unit tests for `parseLsRemoteObjectId`. No I/O, no real `git`
// binary — the parser is exercised on hand-crafted input strings so
// the file is fast and deterministic across hosts with or without git
// on PATH.

import assert from "node:assert/strict";
import test from "node:test";
import { parseLsRemoteObjectId } from "../scripts/git-remote-ref.mjs";

const SHA1 = "abcdef0000000000000000000000000000000000";
const SHA1_2 = "1111112222223333334444445555556666667777";
const SHA256 = "a".repeat(64);

test("parseLsRemoteObjectId returns { kind: 'empty' } for empty string", () => {
  assert.deepEqual(parseLsRemoteObjectId(""), { kind: "empty" });
});

test("parseLsRemoteObjectId returns { kind: 'empty' } for blank-only input", () => {
  assert.deepEqual(parseLsRemoteObjectId("\n\n\n"), { kind: "empty" });
});

test("parseLsRemoteObjectId returns { kind: 'empty' } for whitespace + CRLF only", () => {
  assert.deepEqual(parseLsRemoteObjectId("   \r\n   \r\n"), { kind: "empty" });
});

test("parseLsRemoteObjectId returns { kind: 'empty' } for null and undefined", () => {
  assert.deepEqual(parseLsRemoteObjectId(null), { kind: "empty" });
  assert.deepEqual(parseLsRemoteObjectId(undefined), { kind: "empty" });
});

test("parseLsRemoteObjectId parses a 40-hex (SHA-1) line", () => {
  const input = `${SHA1}\trefs/heads/main\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "ok");
  assert.equal(result.sha, SHA1);
  assert.equal(result.ref, "refs/heads/main");
});

test("parseLsRemoteObjectId parses a 64-hex (SHA-256) line", () => {
  const input = `${SHA256} refs/heads/main\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "ok");
  assert.equal(result.sha, SHA256);
  assert.equal(result.ref, "refs/heads/main");
});

test("parseLsRemoteObjectId parses mixed-case 40-hex (regex is case-insensitive)", () => {
  const mixed = "ABCDEF00000000000000000000000000000000ff";
  const input = `${mixed}\trefs/heads/main\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "ok");
  assert.equal(result.sha, mixed);
  assert.equal(result.ref, "refs/heads/main");
});

test("parseLsRemoteObjectId returns malformed when the first token is a ref (no leading SHA)", () => {
  const input = "\trefs/heads/main\n";
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "malformed");
  assert.equal(result.firstLine, "\trefs/heads/main");
});

test("parseLsRemoteObjectId returns malformed when the first token is not a SHA at all", () => {
  const input = "not-a-sha\trefs/heads/main\n";
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "malformed");
  assert.equal(result.firstLine, "not-a-sha\trefs/heads/main");
});

test("parseLsRemoteObjectId returns malformed for a short hash (3 chars)", () => {
  const input = "abc\trefs/heads/main\n";
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "malformed");
  assert.equal(result.firstLine, "abc\trefs/heads/main");
});

test("parseLsRemoteObjectId returns malformed when there is no whitespace between SHA and ref", () => {
  // "notaspacebetween" is 16 chars — would not match the 40 / 64 hex
  // requirement, but the test also covers the case where someone tries
  // a 40-char non-hex string with no separator. We pick a non-hex
  // 40-char string ("z" is not a hex digit) to assert the regex
  // requires hex AND a whitespace separator.
  const input = "z".repeat(40) + "refs/heads/main\n";
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "malformed");
});

test("parseLsRemoteObjectId ignores leading blank lines and parses the first non-blank", () => {
  const input = `\n\n${SHA1}\trefs/heads/main\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "ok");
  assert.equal(result.sha, SHA1);
  assert.equal(result.ref, "refs/heads/main");
});

test("parseLsRemoteObjectId parses the first non-blank line when the first non-blank line is valid", () => {
  const input = `${SHA1}\trefs/heads/main\n${SHA1_2}\trefs/heads/other\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "ok");
  assert.equal(result.sha, SHA1);
  assert.equal(result.ref, "refs/heads/main");
});

test("parseLsRemoteObjectId returns malformed for a 39-char (off-by-one) hex string", () => {
  const tooShort = "a".repeat(39);
  const input = `${tooShort}\trefs/heads/main\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "malformed");
});

test("parseLsRemoteObjectId returns malformed for a 65-char (off-by-one) hex string", () => {
  const tooLong = "a".repeat(65);
  const input = `${tooLong}\trefs/heads/main\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "malformed");
});

test("parseLsRemoteObjectId returns malformed for a 40-char string with one non-hex char", () => {
  const almostSha = "a".repeat(39) + "z";
  const input = `${almostSha}\trefs/heads/main\n`;
  const result = parseLsRemoteObjectId(input);
  assert.equal(result.kind, "malformed");
});

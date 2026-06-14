import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getAdminSessionSecret,
  getAdminSessionTtlSeconds,
  isAdminSessionSecretValid,
  isAdminSessionValid,
  signAdminSession,
  verifyAdminSession,
} from "../src/lib/admin/session.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const secret = "unit-test-secret-please-ignore";
const baseNow = 1_700_000_000;

const enc = new TextEncoder();

const toBase64Url = (bytes) => {
  let str = "";
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === "function" ? btoa(str) : Buffer.from(str, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const signWithPayload = async (payload, signingSecret = secret) => {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(enc.encode(payloadJson));
  const keyMaterial = enc.encode(signingSecret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payloadB64)));
  return `${payloadB64}.${toBase64Url(sig)}`;
};

const withEnv = (name, value, fn) => {
  const original = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
};

test("正常署名 + 正常検証 roundtrips with the same secret", async () => {
  const cookie = await signAdminSession(secret, { now: baseNow });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow + 30 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.v, 1);
    assert.equal(result.payload.iat, baseNow);
    assert.equal(result.payload.exp, baseNow + 8 * 60 * 60);
  }
});

test("Cookieなし: empty / null / undefined are rejected as missing", async () => {
  const empty = await verifyAdminSession("", secret);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "missing");

  const undef = await verifyAdminSession(undefined, secret);
  assert.equal(undef.ok, false);
  if (!undef.ok) assert.equal(undef.reason, "missing");

  const nul = await verifyAdminSession(null, secret);
  assert.equal(nul.ok, false);
  if (!nul.ok) assert.equal(nul.reason, "missing");
});

test('旧 "1" Cookie: the legacy bypass is rejected', async () => {
  const result = await verifyAdminSession("1", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.notEqual(result.reason, "expired");
  }
});

test('"a.b" Cookie: an obviously malformed two-part cookie is rejected', async () => {
  const result = await verifyAdminSession("a.b", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("payload改ざん: cookie body modified after signing is rejected as bad-signature", async () => {
  const cookie = await signAdminSession(secret, { now: baseNow });
  const [body, sig] = cookie.split(".");
  const tampered = `${body.slice(0, -1)}A.${sig}`;
  const result = await verifyAdminSession(tampered, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-signature");
  }
});

test("署名改ざん: signature modified after signing is rejected as bad-signature", async () => {
  const cookie = await signAdminSession(secret, { now: baseNow });
  const [body, sig] = cookie.split(".");
  const tampered = `${body}.${sig.slice(0, -1)}A`;
  const result = await verifyAdminSession(tampered, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-signature");
  }
});

test("期限切れ: cookie past exp is rejected as expired", async () => {
  // signWithPayload lets us craft a payload with an exp we can age out.
  const cookie = await signWithPayload({ v: 1, iat: baseNow, exp: baseNow + 60 }, secret);
  const result = await verifyAdminSession(cookie, secret, { now: baseNow + 61 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "expired");
  }
});

test("異なるsecret: cookie signed with a different key fails verification", async () => {
  const cookie = await signAdminSession(secret, { now: baseNow });
  const result = await verifyAdminSession(cookie, "a-different-secret", { now: baseNow + 30 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-signature");
  }
});

test("versionなし: payload with no v field is rejected as bad-version", async () => {
  const cookie = await signWithPayload({ iat: baseNow, exp: baseNow + 60 });
  const result = await verifyAdminSession(cookie, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-version");
  }
});

test("未知version: payload with v=2 is rejected as bad-version", async () => {
  const cookie = await signWithPayload({ v: 2, iat: baseNow, exp: baseNow + 60 });
  const result = await verifyAdminSession(cookie, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-version");
  }
});

test("iatが未来: payload with iat in the future is rejected as malformed", async () => {
  const cookie = await signWithPayload({ v: 1, iat: baseNow + 120, exp: baseNow + 300 });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("exp <= iat: payload with exp <= iat is rejected as malformed", async () => {
  const cookie = await signWithPayload({ v: 1, iat: 100, exp: 50 });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("TTLが8時間超過: payload with exp - iat > 8h is rejected as malformed", async () => {
  const cookie = await signWithPayload({
    v: 1,
    iat: baseNow,
    exp: baseNow + 9 * 60 * 60,
  });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("不正Base64URL: cookie with non-base64url characters is rejected", async () => {
  const result = await verifyAdminSession("!@#$.xyz", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.notEqual(result.reason, "expired");
  }
});

test("不正Base64URL: extra '.' separators are rejected as malformed", async () => {
  const result = await verifyAdminSession("a.b.c", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("2048文字超過: cookie longer than 2048 chars is rejected", async () => {
  const validCookie = await signAdminSession(secret, { now: baseNow });
  const padding = "A".repeat(2049 - validCookie.length);
  const oversized = `${validCookie}${padding}`;
  assert.ok(oversized.length > 2048, "padding should push cookie past 2048 chars");
  const result = await verifyAdminSession(oversized, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("ADMIN_SESSION_SECRET 未設定: getAdminSessionSecret returns empty string", () => {
  withEnv("ADMIN_SESSION_SECRET", undefined, () => {
    assert.equal(getAdminSessionSecret(), "");
  });
});

test("ADMIN_MODE_TOKEN と署名secretの分離: a cookie signed with ADMIN_SESSION_SECRET is not verified as ADMIN_MODE_TOKEN", async () => {
  await withEnv("ADMIN_SESSION_SECRET", secret, async () => {
    await withEnv("ADMIN_MODE_TOKEN", "user-supplied-token", async () => {
      const cookie = await signAdminSession(secret, { now: baseNow });
      // ADMIN_MODE_TOKEN is a *user-supplied* code and must never validate
      // the same cookie that ADMIN_SESSION_SECRET signs.
      const wrong = await verifyAdminSession(cookie, "user-supplied-token", {
        now: baseNow + 30,
      });
      assert.equal(wrong.ok, false);
      if (!wrong.ok) {
        assert.equal(wrong.reason, "bad-signature");
      }
      const right = await verifyAdminSession(cookie, secret, { now: baseNow + 30 });
      assert.equal(right.ok, true);
    });
  });
});

test("isAdminSessionValid mirrors verifyAdminSession boolean", async () => {
  // Build a cookie with a short TTL by signing a custom payload.
  const cookie = await signWithPayload({ v: 1, iat: baseNow, exp: baseNow + 60 }, secret);
  // Use a short cookie via custom payload; use the real session TTL cookie
  // for the "currently valid" case.
  const liveCookie = await signAdminSession(secret, { now: baseNow });
  assert.equal(await isAdminSessionValid(liveCookie, secret, { now: baseNow + 30 }), true);
  assert.equal(await isAdminSessionValid(cookie, secret, { now: baseNow + 61 }), false);
  assert.equal(await isAdminSessionValid("1", secret), false);
  assert.equal(await isAdminSessionValid(undefined, secret), false);
});

test("getAdminSessionTtlSeconds is positive and matches the documented 8h", () => {
  assert.equal(getAdminSessionTtlSeconds(), 8 * 60 * 60);
});

test("TTL固定: signAdminSession always issues a cookie whose exp - iat === 28800", async () => {
  for (const now of [baseNow, baseNow + 12345, baseNow + 9_999_999]) {
    const cookie = await signAdminSession(secret, { now });
    const result = await verifyAdminSession(cookie, secret, { now });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.payload.exp - result.payload.iat, 28800);
    }
  }
});

test("TTL固定: signAdminSession には公開の ttlSeconds オプションは存在しない", async () => {
  // Calling signAdminSession with only { now } should produce the same
  // 8-hour-expired cookie regardless of when "now" is; the only knob is `now`.
  const cookie = await signAdminSession(secret, { now: baseNow });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.exp, baseNow + 8 * 60 * 60);
  }
});

test("source: src/lib/admin/session.ts は ttlSeconds 公開APIを公開しない", async () => {
  const sessionPath = path.join(projectRoot, "src", "lib", "admin", "session.ts");
  const content = await fs.readFile(sessionPath, "utf8");
  // No public `ttlSeconds?:` in the SignOptions type, and no `options.ttlSeconds` read.
  assert.ok(
    !/ttlSeconds\s*\?\:/.test(content),
    "session.ts must not declare a public `ttlSeconds?:` option",
  );
  assert.ok(!/options\.ttlSeconds/.test(content), "session.ts must not read `options.ttlSeconds`");
});

test("isAdminSessionSecretValid: 31 ASCII char secret is invalid (32-byte minimum)", () => {
  assert.equal(isAdminSessionSecretValid("a".repeat(31)), false);
});

test("isAdminSessionSecretValid: 32 ASCII char secret is valid", () => {
  assert.equal(isAdminSessionSecretValid("a".repeat(32)), true);
});

test("isAdminSessionSecretValid: UTF-8 multibyte byte count is enforced", () => {
  // Each "日" character is 3 UTF-8 bytes.
  // 16 × "日" = 48 bytes → valid.
  const validMultibyte = "日".repeat(16);
  assert.equal(enc.encode(validMultibyte).byteLength, 48);
  assert.equal(isAdminSessionSecretValid(validMultibyte), true);

  // 10 × "日" = 30 bytes → invalid.
  const tooShortMultibyte = "日".repeat(10);
  assert.equal(enc.encode(tooShortMultibyte).byteLength, 30);
  assert.equal(isAdminSessionSecretValid(tooShortMultibyte), false);
});

test("isAdminSessionSecretValid: empty secret is invalid", () => {
  assert.equal(isAdminSessionSecretValid(""), false);
});

test("isAdminSessionSecretValid: defaults to env when no argument is given", () => {
  withEnv("ADMIN_SESSION_SECRET", "a".repeat(32), () => {
    assert.equal(isAdminSessionSecretValid(), true);
  });
  withEnv("ADMIN_SESSION_SECRET", "a".repeat(31), () => {
    assert.equal(isAdminSessionSecretValid(), false);
  });
  withEnv("ADMIN_SESSION_SECRET", "", () => {
    assert.equal(isAdminSessionSecretValid(), false);
  });
});

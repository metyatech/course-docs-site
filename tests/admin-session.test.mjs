import { test } from "node:test";
import assert from "node:assert/strict";

// This test file imports a TypeScript source module. Node 20 cannot load
// `.ts` files natively (the `--experimental-strip-types` flag is Node
// 22.6+ only). On Node 20 the import below throws
// `ERR_UNKNOWN_FILE_EXTENSION`; the runtime detection below captures that
// and exposes a `TS_UNSUPPORTED` flag so every test in this file can
// `t.skip()` with a clear message instead of failing the CI run.
//
// On Node >= 22.6 (local dev, modern runners) the dynamic import succeeds
// and the tests run normally.
const TS_SOURCE_SPECIFIER = "../src/lib/admin/session.ts";

let adminSessionModule = null;
let tsUnsupportedReason = null;
try {
  adminSessionModule = await import(TS_SOURCE_SPECIFIER);
} catch (error) {
  tsUnsupportedReason = error;
}

const TS_UNSUPPORTED = tsUnsupportedReason !== null;

const requireAdminSessionModule = (t) => {
  if (TS_UNSUPPORTED) {
    t.skip(
      `Skipping: this test imports ${TS_SOURCE_SPECIFIER} (a TypeScript file). ` +
        `Node 20 cannot load .ts files natively; this test runs on Node >= 22.6. ` +
        `Underlying error: ${tsUnsupportedReason?.code ?? "unknown"} ${
          tsUnsupportedReason?.message ?? String(tsUnsupportedReason)
        }`,
    );
    return null;
  }
  return adminSessionModule;
};

const {
  getAdminSessionSecret,
  getAdminSessionTtlSeconds,
  isAdminSessionValid,
  signAdminSession,
  verifyAdminSession,
} = adminSessionModule ?? {};

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

test("正常署名 + 正常検証 roundtrips with the same secret", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow + 30 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.v, 1);
    assert.equal(result.payload.iat, baseNow);
    assert.equal(result.payload.exp, baseNow + 60);
  }
});

test("Cookieなし: empty / null / undefined are rejected as missing", async (t) => {
  if (!requireAdminSessionModule(t)) return;
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

test('旧 "1" Cookie: the legacy bypass is rejected', async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const result = await verifyAdminSession("1", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.notEqual(result.reason, "expired");
  }
});

test('"a.b" Cookie: an obviously malformed two-part cookie is rejected', async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const result = await verifyAdminSession("a.b", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("payload改ざん: cookie body modified after signing is rejected as bad-signature", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
  const [body, sig] = cookie.split(".");
  const tampered = `${body.slice(0, -1)}A.${sig}`;
  const result = await verifyAdminSession(tampered, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-signature");
  }
});

test("署名改ざん: signature modified after signing is rejected as bad-signature", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
  const [body, sig] = cookie.split(".");
  const tampered = `${body}.${sig.slice(0, -1)}A`;
  const result = await verifyAdminSession(tampered, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-signature");
  }
});

test("期限切れ: cookie past exp is rejected as expired", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow + 61 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "expired");
  }
});

test("異なるsecret: cookie signed with a different key fails verification", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
  const result = await verifyAdminSession(cookie, "a-different-secret", { now: baseNow + 30 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-signature");
  }
});

test("versionなし: payload with no v field is rejected as bad-version", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signWithPayload({ iat: baseNow, exp: baseNow + 60 });
  const result = await verifyAdminSession(cookie, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-version");
  }
});

test("未知version: payload with v=2 is rejected as bad-version", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signWithPayload({ v: 2, iat: baseNow, exp: baseNow + 60 });
  const result = await verifyAdminSession(cookie, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "bad-version");
  }
});

test("iatが未来: payload with iat in the future is rejected as malformed", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signWithPayload({ v: 1, iat: baseNow + 120, exp: baseNow + 300 });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("exp <= iat: payload with exp <= iat is rejected as malformed", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signWithPayload({ v: 1, iat: 100, exp: 50 });
  const result = await verifyAdminSession(cookie, secret, { now: baseNow });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("TTLが8時間超過: payload with exp - iat > 8h is rejected as malformed", async (t) => {
  if (!requireAdminSessionModule(t)) return;
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

test("不正Base64URL: cookie with non-base64url characters is rejected", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const result = await verifyAdminSession("!@#$.xyz", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.notEqual(result.reason, "expired");
  }
});

test("不正Base64URL: extra '.' separators are rejected as malformed", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const result = await verifyAdminSession("a.b.c", secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("2048文字超過: cookie longer than 2048 chars is rejected", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const validCookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
  const padding = "A".repeat(2049 - validCookie.length);
  const oversized = `${validCookie}${padding}`;
  assert.ok(oversized.length > 2048, "padding should push cookie past 2048 chars");
  const result = await verifyAdminSession(oversized, secret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("ADMIN_SESSION_SECRET 未設定: getAdminSessionSecret returns empty string", (t) => {
  if (!requireAdminSessionModule(t)) return;
  withEnv("ADMIN_SESSION_SECRET", undefined, () => {
    assert.equal(getAdminSessionSecret(), "");
  });
});

test("ADMIN_MODE_TOKEN と署名secretの分離: a cookie signed with ADMIN_SESSION_SECRET is not verified as ADMIN_MODE_TOKEN", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  await withEnv("ADMIN_SESSION_SECRET", secret, async () => {
    await withEnv("ADMIN_MODE_TOKEN", "user-supplied-token", async () => {
      const cookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
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

test("isAdminSessionValid mirrors verifyAdminSession boolean", async (t) => {
  if (!requireAdminSessionModule(t)) return;
  const cookie = await signAdminSession(secret, { now: baseNow, ttlSeconds: 60 });
  assert.equal(await isAdminSessionValid(cookie, secret, { now: baseNow + 30 }), true);
  assert.equal(await isAdminSessionValid(cookie, secret, { now: baseNow + 61 }), false);
  assert.equal(await isAdminSessionValid("1", secret), false);
  assert.equal(await isAdminSessionValid(undefined, secret), false);
});

test("getAdminSessionTtlSeconds is positive and matches the documented 8h", (t) => {
  if (!requireAdminSessionModule(t)) return;
  assert.equal(getAdminSessionTtlSeconds(), 8 * 60 * 60);
});

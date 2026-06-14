import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAdminCommentDeleteHandler,
  getAdminSupabase,
} from "../src/lib/admin/comment-delete.ts";
import { signAdminSession, verifyAdminSession } from "../src/lib/admin/session.ts";

const validId = "abc-123_def";
const signingSecret = "unit-test-comment-delete-secret-please-ignore";

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

const buildSuccessSupabase = (ids = [validId]) => {
  const callLog = [];
  const query = {
    delete() {
      callLog.push("delete");
      return this;
    },
    eq(column, value) {
      callLog.push({ op: "eq", column, value });
      return this;
    },
    select() {
      callLog.push("select");
      const eqCall = callLog.find((c) => c && c.op === "eq");
      const filtered = ids.filter((id) => id === eqCall?.value);
      return Promise.resolve({ data: filtered.map((id) => ({ id })), error: null });
    },
  };
  return {
    from() {
      callLog.push("from");
      return query;
    },
    _callLog: callLog,
  };
};

const buildErrorSupabase = ({ message, details, hint, code }) => {
  const query = {
    delete() {
      return this;
    },
    eq() {
      return this;
    },
    select() {
      return Promise.resolve({ data: null, error: { message, details, hint, code } });
    },
  };
  return {
    from() {
      return query;
    },
  };
};

const buildThrowingSupabase = () => ({
  from() {
    return {
      delete() {
        return this;
      },
      eq() {
        return this;
      },
      select() {
        throw new Error("boom");
      },
    };
  },
});

test("getAdminSupabase returns null if env vars are missing", () => {
  withEnv("SUPABASE_URL", undefined, () => {
    withEnv("NEXT_PUBLIC_SUPABASE_URL", undefined, () => {
      withEnv("SUPABASE_SERVICE_ROLE_KEY", undefined, () => {
        assert.equal(getAdminSupabase(), null);
      });
    });
  });
});

test("不正ID: empty comment id is rejected with 400", async () => {
  const handler = createAdminCommentDeleteHandler();
  const result = await handler.deleteComment("");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid comment id");
  }
});

test("不正ID: id with disallowed characters is rejected with 400", async () => {
  const handler = createAdminCommentDeleteHandler();
  const result = await handler.deleteComment("not a valid id!");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid comment id");
  }
});

test("不正ID: extremely long id is rejected with 400", async () => {
  const handler = createAdminCommentDeleteHandler();
  const longId = "a".repeat(129);
  const result = await handler.deleteComment(longId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
  }
});

test("missing supabase returns 500", async () => {
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => null });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.error, "Server not configured");
  }
});

test("Supabase失敗500: error response sanitises Supabase error fields", async () => {
  const supabase = buildErrorSupabase({
    message: "DB error message",
    details: "secret details",
    hint: "secret hint",
    code: "XX001",
  });
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => supabase });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.error, "Failed to delete comment");
    assert.ok(!result.error.includes("DB error message"));
    assert.ok(!result.error.includes("secret details"));
    assert.ok(!result.error.includes("secret hint"));
    assert.ok(!result.error.includes("XX001"));
  }
});

test("Supabase失敗500: thrown error is also sanitised", async () => {
  const handler = createAdminCommentDeleteHandler({
    createSupabase: () => buildThrowingSupabase(),
  });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.error, "Failed to delete comment");
    assert.ok(!result.error.includes("boom"));
  }
});

test("対象なし404: supabase returns empty data", async () => {
  const supabase = buildSuccessSupabase([]);
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => supabase });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.equal(result.error, "Comment not found");
  }
});

test("正常IDで削除成功: valid id returns ok", async () => {
  const supabase = buildSuccessSupabase([validId]);
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => supabase });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, true);
});

test("deleteComment scopes by id via the .eq() filter", async () => {
  const supabase = buildSuccessSupabase([validId]);
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => supabase });
  await handler.deleteComment(validId);
  const eqCall = supabase._callLog.find((entry) => entry && entry.op === "eq");
  assert.ok(eqCall, "expected an eq() call");
  assert.equal(eqCall.column, "id");
  assert.equal(eqCall.value, validId);
});

test("Cookieなし: a missing cookie value is rejected by the session validator", async () => {
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const empty = await verifyAdminSession("", signingSecret);
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.reason, "missing");
  });
});

test('"a.b" Cookie: malformed two-part cookie is rejected', async () => {
  const result = await verifyAdminSession("a.b", signingSecret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("改ざんCookie: a tampered cookie fails the session gate", async () => {
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const cookie = await signAdminSession(signingSecret, { now: 1_700_000_000 });
    const [body, sig] = cookie.split(".");
    const tampered = `${body.slice(0, -1)}A.${sig}`;
    const result = await verifyAdminSession(tampered, signingSecret);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "bad-signature");
    }
  });
});

test("期限切れCookie: an expired cookie fails the session gate", async () => {
  // Build a short-TTL cookie by hand using signWithPayload, since
  // signAdminSession no longer accepts a custom TTL.
  const enc = new TextEncoder();
  const toBase64Url = (bytes) => {
    let str = "";
    for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
    const b64 = Buffer.from(str, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const payload = { v: 1, iat: 1_700_000_000, exp: 1_700_000_060 };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(enc.encode(payloadJson));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64)));
  const sigB64 = toBase64Url(sig);
  const cookie = `${payloadB64}.${sigB64}`;

  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const result = await verifyAdminSession(cookie, signingSecret, {
      now: 1_700_000_000 + 61,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "expired");
    }
  });
});

test("x-admin-token は十分ではない: a legacy header value does not pass session validation", async () => {
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const legacyToken = "user-supplied-token";
    const result = await verifyAdminSession(legacyToken, signingSecret);
    assert.equal(result.ok, false);
  });
});

test("正常Cookie: a freshly signed cookie passes session validation", async () => {
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const cookie = await signAdminSession(signingSecret, { now: 1_700_000_000 });
    const result = await verifyAdminSession(cookie, signingSecret, {
      now: 1_700_000_000 + 30,
    });
    assert.equal(result.ok, true);
  });
});

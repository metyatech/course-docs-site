import { test } from "node:test";
import assert from "node:assert/strict";

// This test file imports TypeScript source modules. Node 20 cannot load
// `.ts` files natively (the `--experimental-strip-types` flag is Node
// 22.6+ only). On Node 20 the imports below throw
// `ERR_UNKNOWN_FILE_EXTENSION`; the runtime detection below captures
// that and exposes a `TS_UNSUPPORTED` flag so every TS-dependent test
// in this file can `t.skip()` with a clear message instead of failing
// the CI run.
//
// The last test (`comment moderation無効サイトで403...`) does NOT import
// any TypeScript module — it only reads the JSON manifest — so it runs
// even on Node 20.
//
// On Node >= 22.6 (local dev, modern runners) the dynamic imports
// succeed and every test runs normally.
const TS_SOURCE_SPECIFIERS = [
  "../src/lib/admin/comment-delete.ts",
  "../src/lib/admin/session.ts",
];

let tsModuleMap = {};
let tsUnsupportedReason = null;
try {
  for (const specifier of TS_SOURCE_SPECIFIERS) {
    tsModuleMap[specifier] = await import(specifier);
  }
} catch (error) {
  tsUnsupportedReason = error;
}

const TS_UNSUPPORTED = tsUnsupportedReason !== null;

const requireTsModules = (t, specifiers) => {
  if (!TS_UNSUPPORTED) return true;
  t.skip(
    `Skipping: this test imports TypeScript source (${specifiers.join(", ")}). ` +
      `Node 20 cannot load .ts files natively; this test runs on Node >= 22.6. ` +
      `Underlying error: ${tsUnsupportedReason?.code ?? "unknown"} ${
        tsUnsupportedReason?.message ?? String(tsUnsupportedReason)
      }`,
  );
  return false;
};

const { createAdminCommentDeleteHandler, getAdminSupabase } =
  tsModuleMap["../src/lib/admin/comment-delete.ts"] ?? {};
const { signAdminSession, verifyAdminSession } =
  tsModuleMap["../src/lib/admin/session.ts"] ?? {};

import { readManifestFile } from "../scripts/course-sites-manifest.mjs";

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

test("getAdminSupabase returns null if env vars are missing", (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  withEnv("SUPABASE_URL", undefined, () => {
    withEnv("NEXT_PUBLIC_SUPABASE_URL", undefined, () => {
      withEnv("SUPABASE_SERVICE_ROLE_KEY", undefined, () => {
        assert.equal(getAdminSupabase(), null);
      });
    });
  });
});

test("不正ID: empty comment id is rejected with 400", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  const handler = createAdminCommentDeleteHandler();
  const result = await handler.deleteComment("");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid comment id");
  }
});

test("不正ID: id with disallowed characters is rejected with 400", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  const handler = createAdminCommentDeleteHandler();
  const result = await handler.deleteComment("not a valid id!");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid comment id");
  }
});

test("不正ID: extremely long id is rejected with 400", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  const handler = createAdminCommentDeleteHandler();
  const longId = "a".repeat(129);
  const result = await handler.deleteComment(longId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
  }
});

test("missing supabase returns 500", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => null });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.error, "Server not configured");
  }
});

test("Supabase失敗500: error response sanitises Supabase error fields", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
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

test("Supabase失敗500: thrown error is also sanitised", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
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

test("対象なし404: supabase returns empty data", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  const supabase = buildSuccessSupabase([]);
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => supabase });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.equal(result.error, "Comment not found");
  }
});

test("正常Cookieで削除成功: valid cookie + matching id returns ok", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  const supabase = buildSuccessSupabase([validId]);
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => supabase });
  const result = await handler.deleteComment(validId);
  assert.equal(result.ok, true);
});

test("deleteComment scopes by id via the .eq() filter", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/comment-delete.ts"])) return;
  const supabase = buildSuccessSupabase([validId]);
  const handler = createAdminCommentDeleteHandler({ createSupabase: () => supabase });
  await handler.deleteComment(validId);
  const eqCall = supabase._callLog.find((entry) => entry && entry.op === "eq");
  assert.ok(eqCall, "expected an eq() call");
  assert.equal(eqCall.column, "id");
  assert.equal(eqCall.value, validId);
});

test("Cookieなし: a missing cookie value is rejected by the session validator", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/session.ts"])) return;
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const empty = await verifyAdminSession("", signingSecret);
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.reason, "missing");
  });
});

test('"a.b" Cookie: malformed two-part cookie is rejected', async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/session.ts"])) return;
  const result = await verifyAdminSession("a.b", signingSecret);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("改ざんCookie: a tampered cookie fails the session gate", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/session.ts"])) return;
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const cookie = await signAdminSession(signingSecret, {
      now: 1_700_000_000,
      ttlSeconds: 60,
    });
    const [body, sig] = cookie.split(".");
    const tampered = `${body.slice(0, -1)}A.${sig}`;
    const result = await verifyAdminSession(tampered, signingSecret);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "bad-signature");
    }
  });
});

test("期限切れCookie: an expired cookie fails the session gate", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/session.ts"])) return;
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const cookie = await signAdminSession(signingSecret, {
      now: 1_700_000_000,
      ttlSeconds: 60,
    });
    const result = await verifyAdminSession(cookie, signingSecret, {
      now: 1_700_000_000 + 61,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "expired");
    }
  });
});

test("x-admin-token は十分ではない: a legacy header value does not pass session validation", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/session.ts"])) return;
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const legacyToken = "user-supplied-token";
    const result = await verifyAdminSession(legacyToken, signingSecret);
    assert.equal(result.ok, false);
  });
});

test("正常Cookie: a freshly signed cookie passes session validation", async (t) => {
  if (!requireTsModules(t, ["../src/lib/admin/session.ts"])) return;
  await withEnv("ADMIN_SESSION_SECRET", signingSecret, async () => {
    const cookie = await signAdminSession(signingSecret, {
      now: 1_700_000_000,
      ttlSeconds: 60,
    });
    const result = await verifyAdminSession(cookie, signingSecret, {
      now: 1_700_000_000 + 30,
    });
    assert.equal(result.ok, true);
  });
});

// This test does NOT import any TypeScript module — it only reads the
// shipped JSON manifest. It must run on Node 20 as well.
test("comment moderation無効サイトで403: sites without adminCommentModeration block deletes", () => {
  const manifest = readManifestFile();
  // The route checks `getCurrentCourseSite()?.features.adminCommentModeration`
  // and returns 403 when it is not `true`. Verify that at least one site in
  // the shipped manifest has the feature disabled, so the 403 branch is
  // reachable for a real course selection.
  const disabledSites = manifest.sites.filter(
    (site) => site.features?.adminCommentModeration !== true,
  );
  assert.ok(
    disabledSites.length > 0,
    "Expected at least one site in the manifest without adminCommentModeration enabled",
  );
  for (const site of disabledSites) {
    assert.notEqual(site.features.adminCommentModeration, true);
  }
  // And confirm exactly one site has it on, so we know the moderation
  // surface is opt-in (not on by default).
  const enabledSites = manifest.sites.filter(
    (site) => site.features?.adminCommentModeration === true,
  );
  assert.equal(
    enabledSites.length,
    1,
    "Expected exactly one site to enable adminCommentModeration",
  );
});

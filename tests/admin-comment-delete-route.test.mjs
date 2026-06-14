import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdminCommentDeleteRoute } from "../src/lib/admin/comment-delete-route.ts";
import {
  isAdminSessionValid as isSignedAdminSessionValid,
  signAdminSession,
} from "../src/lib/admin/session.ts";

const SIGNING_SECRET = "unit-test-route-signing-secret-please-ignore";

const enc = new TextEncoder();
const dec = new TextDecoder();

const toBase64Url = (bytes) => {
  let str = "";
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(bytes[i]);
  }
  const b64 = Buffer.from(str, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (input) => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// Build a short-TTL signed cookie by hand so the route's session validator
// can age it out. This mirrors the on-the-wire format produced by
// `signAdminSession`, but lets us choose `exp`.
const signShortCookie = async (iat, ttlSeconds, secret = SIGNING_SECRET) => {
  const payload = { v: 1, iat, exp: iat + ttlSeconds };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(enc.encode(payloadJson));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64)));
  return `${payloadB64}.${toBase64Url(sig)}`;
};

// Build a cookie with the same key but the body tampered after signing.
const tamperBody = (cookie) => {
  const [body, sig] = cookie.split(".");
  return `${body.slice(0, -1)}A.${sig}`;
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

const buildRequest = ({
  url = "https://example.com/api/admin/comments/abc-123",
  headers = {},
} = {}) => new Request(url, { method: "DELETE", headers });

const okContext = (id = "abc-123") => ({ params: Promise.resolve({ id }) });

const noopDelete = async () => ({ ok: true });

const callLog = () => {
  const calls = [];
  return {
    calls,
    deleteComment: async (...args) => {
      calls.push(args);
      return { ok: true };
    },
  };
};

test("createAdminCommentDeleteRoute is a function factory returning a handler", () => {
  assert.equal(typeof createAdminCommentDeleteRoute, "function");
  const handler = createAdminCommentDeleteRoute({ deleteComment: noopDelete });
  assert.equal(typeof handler, "function");
});

test("same-origin fail → 403", async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => false,
    getCookieValue: async () => "some-cookie",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const request = buildRequest();
  const response = await handler(request, okContext());
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "Forbidden");
  assert.equal(deleteLog.calls.length, 0, "delete handler must not be called on 403");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("no cookie → 401", async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: () => undefined,
    isAdminSessionValid: async () => false,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const request = buildRequest();
  const response = await handler(request, okContext());
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "Unauthorized");
  assert.equal(deleteLog.calls.length, 0, "delete handler must not be called on 401");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("only x-admin-token header → 401 (legacy header does not satisfy session check)", async () => {
  await withEnv("ADMIN_SESSION_SECRET", SIGNING_SECRET, async () => {
    const deleteLog = callLog();
    const legacyHeader = "user-supplied-token";
    let observedCookie;
    const handler = createAdminCommentDeleteRoute({
      isSameOriginMutation: () => true,
      getCookieValue: () => undefined, // no cookie at all
      isAdminSessionValid: async (cookie) => {
        observedCookie = cookie;
        return false;
      },
      isAdminCommentModerationEnabled: () => true,
      deleteComment: deleteLog.deleteComment,
    });
    const request = buildRequest({ headers: { "x-admin-token": legacyHeader } });
    const response = await handler(request, okContext());
    assert.equal(response.status, 401);
    assert.equal(deleteLog.calls.length, 0, "delete handler must not be called on 401");
    assert.equal(observedCookie, undefined, "session check must observe no cookie");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test('"a.b" cookie equivalent → 401', async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: () => "a.b",
    isAdminSessionValid: async (cookie) => {
      // Real session validator would reject "a.b" as malformed.
      assert.equal(cookie, "a.b");
      return false;
    },
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const request = buildRequest();
  const response = await handler(request, okContext());
  assert.equal(response.status, 401);
  assert.equal(deleteLog.calls.length, 0, "delete handler must not be called on 401");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("tampered cookie → 401", async () => {
  await withEnv("ADMIN_SESSION_SECRET", SIGNING_SECRET, async () => {
    const deleteLog = callLog();
    const valid = await signShortCookie(1_700_000_000, 60);
    const tampered = tamperBody(valid);
    const handler = createAdminCommentDeleteRoute({
      isSameOriginMutation: () => true,
      getCookieValue: () => tampered,
      isAdminSessionValid: async (cookie) => {
        // The real session validator would return false on bad signature.
        assert.equal(cookie, tampered);
        return false;
      },
      isAdminCommentModerationEnabled: () => true,
      deleteComment: deleteLog.deleteComment,
    });
    const request = buildRequest();
    const response = await handler(request, okContext());
    assert.equal(response.status, 401);
    assert.equal(deleteLog.calls.length, 0, "delete handler must not be called on 401");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("expired cookie → 401", async () => {
  await withEnv("ADMIN_SESSION_SECRET", SIGNING_SECRET, async () => {
    const deleteLog = callLog();
    const expired = await signShortCookie(1_700_000_000, 60);
    const handler = createAdminCommentDeleteRoute({
      isSameOriginMutation: () => true,
      getCookieValue: () => expired,
      isAdminSessionValid: async (cookie) => {
        // The real session validator would return false for an expired cookie.
        assert.equal(cookie, expired);
        return false;
      },
      isAdminCommentModerationEnabled: () => true,
      deleteComment: deleteLog.deleteComment,
    });
    const request = buildRequest();
    const response = await handler(request, okContext());
    assert.equal(response.status, 401);
    assert.equal(deleteLog.calls.length, 0, "delete handler must not be called on 401");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("comment moderation disabled → 403", async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: async () => "valid",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => false,
    deleteComment: deleteLog.deleteComment,
  });
  const request = buildRequest();
  const response = await handler(request, okContext());
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "Comment moderation is not enabled for this site");
  assert.equal(deleteLog.calls.length, 0, "delete handler must not be called on 403");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("invalid comment id from delete handler (400) → Route returns 400", async () => {
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: async () => "valid",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: async () => ({ ok: false, error: "Invalid comment id", status: 400 }),
  });
  const request = buildRequest();
  const response = await handler(request, okContext("not a valid id!"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "Invalid comment id");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("successful delete → 200 { ok: true }", async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: async () => "valid",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const request = buildRequest();
  const response = await handler(request, okContext());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true });
  assert.equal(deleteLog.calls.length, 1);
  assert.equal(deleteLog.calls[0][0], "abc-123");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("not found → 404 { error: 'Comment not found' }", async () => {
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: async () => "valid",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: async () => ({ ok: false, error: "Comment not found", status: 404 }),
  });
  const request = buildRequest();
  const response = await handler(request, okContext("missing-id"));
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, "Comment not found");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("Supabase failure → 500 { error: 'Failed to delete comment' }", async () => {
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: async () => "valid",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: async () => ({ ok: false, error: "Failed to delete comment", status: 500 }),
  });
  const request = buildRequest();
  const response = await handler(request, okContext());
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "Failed to delete comment");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("all responses have Cache-Control: no-store across status codes", async () => {
  const cases = [
    {
      status: 200,
      body: { ok: true },
      factory: (dl) =>
        createAdminCommentDeleteRoute({
          isSameOriginMutation: () => true,
          getCookieValue: async () => "valid",
          isAdminSessionValid: async () => true,
          isAdminCommentModerationEnabled: () => true,
          deleteComment: dl.deleteComment,
        }),
    },
    {
      status: 401,
      body: { error: "Unauthorized" },
      factory: () =>
        createAdminCommentDeleteRoute({
          isSameOriginMutation: () => true,
          getCookieValue: () => undefined,
          isAdminSessionValid: async () => false,
          isAdminCommentModerationEnabled: () => true,
          deleteComment: async () => ({ ok: true }),
        }),
    },
    {
      status: 403,
      body: { error: "Forbidden" },
      factory: () =>
        createAdminCommentDeleteRoute({
          isSameOriginMutation: () => false,
          getCookieValue: async () => "valid",
          isAdminSessionValid: async () => true,
          isAdminCommentModerationEnabled: () => true,
          deleteComment: async () => ({ ok: true }),
        }),
    },
    {
      status: 400,
      body: { error: "Invalid comment id" },
      factory: () =>
        createAdminCommentDeleteRoute({
          isSameOriginMutation: () => true,
          getCookieValue: async () => "valid",
          isAdminSessionValid: async () => true,
          isAdminCommentModerationEnabled: () => true,
          deleteComment: async () => ({ ok: false, error: "Invalid comment id", status: 400 }),
        }),
    },
    {
      status: 404,
      body: { error: "Comment not found" },
      factory: () =>
        createAdminCommentDeleteRoute({
          isSameOriginMutation: () => true,
          getCookieValue: async () => "valid",
          isAdminSessionValid: async () => true,
          isAdminCommentModerationEnabled: () => true,
          deleteComment: async () => ({ ok: false, error: "Comment not found", status: 404 }),
        }),
    },
    {
      status: 500,
      body: { error: "Failed to delete comment" },
      factory: () =>
        createAdminCommentDeleteRoute({
          isSameOriginMutation: () => true,
          getCookieValue: async () => "valid",
          isAdminSessionValid: async () => true,
          isAdminCommentModerationEnabled: () => true,
          deleteComment: async () => ({
            ok: false,
            error: "Failed to delete comment",
            status: 500,
          }),
        }),
    },
  ];
  for (const { status, factory } of cases) {
    const dl = callLog();
    const handler = factory(dl);
    const response = await handler(buildRequest(), okContext());
    assert.equal(response.status, status, `unexpected status for case ${status}`);
    assert.equal(
      response.headers.get("cache-control"),
      "no-store",
      `Cache-Control must be no-store for ${status}`,
    );
  }
});

test("delete handler is NOT called on 401 (session failure)", async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: () => undefined,
    isAdminSessionValid: async () => false,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const response = await handler(buildRequest(), okContext());
  assert.equal(response.status, 401);
  assert.equal(deleteLog.calls.length, 0);
});

test("delete handler is NOT called on 403 (same-origin failure)", async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => false,
    getCookieValue: async () => "valid",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const response = await handler(buildRequest(), okContext());
  assert.equal(response.status, 403);
  assert.equal(deleteLog.calls.length, 0);
});

test("delete handler is NOT called on 403 (capability disabled)", async () => {
  const deleteLog = callLog();
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: async () => "valid",
    isAdminSessionValid: async () => true,
    isAdminCommentModerationEnabled: () => false,
    deleteComment: deleteLog.deleteComment,
  });
  const response = await handler(buildRequest(), okContext());
  assert.equal(response.status, 403);
  assert.equal(deleteLog.calls.length, 0);
});

test("processing order: same-origin → session → capability → delete", async () => {
  const order = [];
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => {
      order.push("same-origin");
      return false; // fail at the first gate
    },
    getCookieValue: () => {
      order.push("cookie");
      return undefined;
    },
    isAdminSessionValid: () => {
      order.push("session");
      return false;
    },
    isAdminCommentModerationEnabled: () => {
      order.push("capability");
      return false;
    },
    deleteComment: () => {
      order.push("delete");
      return Promise.resolve({ ok: true });
    },
  });
  await handler(buildRequest(), okContext());
  assert.deepEqual(order, ["same-origin"], "first gate is same-origin");

  // Now pass same-origin, fail at session.
  order.length = 0;
  const handler2 = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => {
      order.push("same-origin");
      return true;
    },
    getCookieValue: () => {
      order.push("cookie");
      return undefined;
    },
    isAdminSessionValid: () => {
      order.push("session");
      return false;
    },
    isAdminCommentModerationEnabled: () => {
      order.push("capability");
      return true;
    },
    deleteComment: () => {
      order.push("delete");
      return Promise.resolve({ ok: true });
    },
  });
  await handler2(buildRequest(), okContext());
  assert.deepEqual(order, ["same-origin", "cookie", "session"]);

  // Now pass same-origin + session, fail at capability.
  order.length = 0;
  const handler3 = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => {
      order.push("same-origin");
      return true;
    },
    getCookieValue: () => {
      order.push("cookie");
      return "valid";
    },
    isAdminSessionValid: () => {
      order.push("session");
      return true;
    },
    isAdminCommentModerationEnabled: () => {
      order.push("capability");
      return false;
    },
    deleteComment: () => {
      order.push("delete");
      return Promise.resolve({ ok: true });
    },
  });
  await handler3(buildRequest(), okContext());
  assert.deepEqual(order, ["same-origin", "cookie", "session", "capability"]);

  // Finally, all gates pass and delete is invoked last.
  order.length = 0;
  const handler4 = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => {
      order.push("same-origin");
      return true;
    },
    getCookieValue: () => {
      order.push("cookie");
      return "valid";
    },
    isAdminSessionValid: () => {
      order.push("session");
      return true;
    },
    isAdminCommentModerationEnabled: () => {
      order.push("capability");
      return true;
    },
    deleteComment: () => {
      order.push("delete");
      return Promise.resolve({ ok: true });
    },
  });
  await handler4(buildRequest(), okContext());
  assert.deepEqual(order, ["same-origin", "cookie", "session", "capability", "delete"]);
});

test("real session integration: a valid cookie is accepted by the real validator", async () => {
  const deleteLog = callLog();
  // signAdminSession uses the current real time by default and the
  // 8-hour fixed TTL, so the cookie is valid right now. We inject the real
  // low-level signature validator with an explicit secret so this test does
  // not depend on ADMIN_MODE_TOKEN, the synced manifest site, or
  // isAdminModeConfigured() — only on the cryptographic session check.
  const cookie = await signAdminSession(SIGNING_SECRET);
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: () => cookie,
    isAdminSessionValid: (value) => isSignedAdminSessionValid(value, SIGNING_SECRET),
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const request = buildRequest();
  const response = await handler(request, okContext());
  assert.equal(response.status, 200);
  assert.equal(deleteLog.calls.length, 1);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("real session integration: an expired cookie is rejected by the real validator", async () => {
  const deleteLog = callLog();
  // The cookie is genuinely signed with SIGNING_SECRET but already expired, so
  // the injected real validator rejects it because of expiry (not because of a
  // bad/invalid site configuration).
  const expired = await signShortCookie(1_700_000_000, 60);
  const handler = createAdminCommentDeleteRoute({
    isSameOriginMutation: () => true,
    getCookieValue: () => expired,
    isAdminSessionValid: (value) => isSignedAdminSessionValid(value, SIGNING_SECRET),
    isAdminCommentModerationEnabled: () => true,
    deleteComment: deleteLog.deleteComment,
  });
  const response = await handler(buildRequest(), okContext());
  assert.equal(response.status, 401);
  assert.equal(deleteLog.calls.length, 0);
});

// Avoid unused-import warnings.
test("noUnusedImportsSentinel", () => {
  assert.ok(typeof dec === "object");
  assert.ok(typeof fromBase64Url === "function");
});

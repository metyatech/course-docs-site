import { test } from "node:test";
import assert from "node:assert/strict";
import { signAdminSession } from "../src/lib/admin/session.ts";
import { isAdminAuthorizedForCommentDelete } from "../src/lib/admin/comment-delete-route.ts";

const VALID_TOKEN = "a".repeat(32);
const VALID_SECRET = "b".repeat(32);

const withEnv = async (mutator, fn) => {
  const before = { ...process.env };
  try {
    mutator(process.env);
    return await fn();
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in before)) delete process.env[k];
    }
    Object.assign(process.env, before);
  }
};

test("isAdminAuthorizedForCommentDelete: short ADMIN_SESSION_SECRET returns false", async () => {
  await withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = VALID_TOKEN;
      env.ADMIN_SESSION_SECRET = "a".repeat(31);
    },
    async () => {
      assert.equal(await isAdminAuthorizedForCommentDelete("any-cookie"), false);
    },
  );
});

test("isAdminAuthorizedForCommentDelete: identical token and secret returns false", async () => {
  const same = "a".repeat(32);
  await withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = same;
      env.ADMIN_SESSION_SECRET = same;
    },
    async () => {
      assert.equal(await isAdminAuthorizedForCommentDelete("any-cookie"), false);
    },
  );
});

test("isAdminAuthorizedForCommentDelete: missing ADMIN_MODE_TOKEN returns false", async () => {
  await withEnv(
    (env) => {
      delete env.ADMIN_MODE_TOKEN;
      env.ADMIN_SESSION_SECRET = VALID_SECRET;
    },
    async () => {
      assert.equal(await isAdminAuthorizedForCommentDelete("any-cookie"), false);
    },
  );
});

test("isAdminAuthorizedForCommentDelete: site config without capability returns false", async () => {
  await withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = VALID_TOKEN;
      env.ADMIN_SESSION_SECRET = VALID_SECRET;
    },
    async () => {
      const cookie = await signAdminSession(VALID_SECRET);
      // The checked-in default site config has no admin capability. A valid
      // cookie and valid secrets must still fail closed for that site.
      assert.equal(await isAdminAuthorizedForCommentDelete(cookie), false);
    },
  );
});

test("isAdminAuthorizedForCommentDelete: distinct valid values + configured mock + valid cookie returns true", async () => {
  await withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = VALID_TOKEN;
      env.ADMIN_SESSION_SECRET = VALID_SECRET;
    },
    async () => {
      const cookie = await signAdminSession(VALID_SECRET);
      const result = await isAdminAuthorizedForCommentDelete(cookie, {
        isAdminModeConfigured: () => true,
      });
      assert.equal(result, true);
    },
  );
});

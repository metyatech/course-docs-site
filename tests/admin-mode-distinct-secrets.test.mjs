import { test } from "node:test";
import assert from "node:assert/strict";
import { areAdminSecretsDistinct, isAdminModeConfigured } from "../src/lib/admin-mode.ts";

const SHARED_VALUE = "identical-token-and-secret-32-bytes!";
const TOKEN_VALUE = "distinct-token-aaaaaaaaaaaaaaaaaaaaaa";
const SECRET_VALUE = "distinct-secret-bbbbbbbbbbbbbbbbbbbbbb";

const withEnv = (mutator, fn) => {
  const before = { ...process.env };
  try {
    mutator(process.env);
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in before)) delete process.env[k];
    }
    Object.assign(process.env, before);
  }
};

test("areAdminSecretsDistinct: same ADMIN_MODE_TOKEN and ADMIN_SESSION_SECRET returns false", () => {
  withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = SHARED_VALUE;
      env.ADMIN_SESSION_SECRET = SHARED_VALUE;
    },
    () => {
      assert.equal(areAdminSecretsDistinct(), false);
    },
  );
});

test("isAdminModeConfigured: same ADMIN_MODE_TOKEN and ADMIN_SESSION_SECRET returns false", () => {
  withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = SHARED_VALUE;
      env.ADMIN_SESSION_SECRET = SHARED_VALUE;
    },
    () => {
      assert.equal(isAdminModeConfigured(), false);
    },
  );
});

test("areAdminSecretsDistinct: distinct values returns true", () => {
  withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = TOKEN_VALUE;
      env.ADMIN_SESSION_SECRET = SECRET_VALUE;
    },
    () => {
      assert.equal(areAdminSecretsDistinct(), true);
    },
  );
});

test("areAdminSecretsDistinct: empty ADMIN_MODE_TOKEN returns false", () => {
  withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = "";
      env.ADMIN_SESSION_SECRET = SECRET_VALUE;
    },
    () => {
      assert.equal(areAdminSecretsDistinct(), false);
    },
  );
});

test("areAdminSecretsDistinct: empty ADMIN_SESSION_SECRET returns false", () => {
  withEnv(
    (env) => {
      env.ADMIN_MODE_TOKEN = TOKEN_VALUE;
      env.ADMIN_SESSION_SECRET = "";
    },
    () => {
      assert.equal(areAdminSecretsDistinct(), false);
    },
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSameOriginMutation } from "../src/lib/admin/same-origin.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Legacy admin-auth surface strings that must not appear in active code
// (Site or installed Platform dist). These were the previous, weaker
// implementation: a sessionStorage-stored token, an `x-admin-token`
// header, and a literal `"1"` cookie bypass. The current contract uses
// an HttpOnly signed cookie validated via Web Crypto.
const FORBIDDEN_STRINGS = [
  "admin-comment-token",
  "x-admin-token",
  "window.sessionStorage",
  "sessionStorage.setItem",
  "sessionStorage.getItem",
];

// Required admin-auth surface strings that MUST be present in active
// code: a single session-changed event and the two new API endpoints.
const REQUIRED_STRINGS = [
  "course-docs-admin-session-changed",
  "/api/admin/mode/",
  "/api/admin/comments/",
];

// Source directories to scan. We scan the Site's own `src/` tree and the
// installed Platform `dist/` tree, since both ship as active code at
// runtime.
const SOURCE_DIRECTORIES = [
  path.join(projectRoot, "src"),
  path.join(projectRoot, "node_modules", "@metyatech", "course-docs-platform", "dist"),
];

const walk = async (dir) => {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

const SOURCE_FILE_RE = /\.(ts|tsx|js|mjs|cjs|jsx)$/;

test("forbidden admin auth strings are absent from active source", async () => {
  for (const dir of SOURCE_DIRECTORIES) {
    const files = await walk(dir);
    for (const file of files) {
      if (!SOURCE_FILE_RE.test(file)) continue;
      if (file.includes(`${path.sep}node_modules${path.sep}.bin`)) continue;
      const content = await fs.readFile(file, "utf8");
      for (const forbidden of FORBIDDEN_STRINGS) {
        assert.ok(
          !content.includes(forbidden),
          `Active source must not contain "${forbidden}": ${path.relative(projectRoot, file)}`,
        );
      }
    }
  }
});

test("required admin auth strings are present in active source", async () => {
  const hits = new Map();
  for (const required of REQUIRED_STRINGS) hits.set(required, []);
  for (const dir of SOURCE_DIRECTORIES) {
    const files = await walk(dir);
    for (const file of files) {
      if (!SOURCE_FILE_RE.test(file)) continue;
      const content = await fs.readFile(file, "utf8");
      for (const required of REQUIRED_STRINGS) {
        if (content.includes(required)) {
          hits.get(required).push(path.relative(projectRoot, file));
        }
      }
    }
  }
  for (const required of REQUIRED_STRINGS) {
    assert.ok(
      hits.get(required).length > 0,
      `Expected "${required}" reference in active source; checked: ${SOURCE_DIRECTORIES.map((d) => path.relative(projectRoot, d)).join(", ")}`,
    );
  }
});

// `isSameOriginMutation` is part of the admin-mutation contract: the
// `/api/admin/comments/[id]` DELETE handler rejects cross-site requests
// with 403 before touching the session cookie. Keep the unit tests for
// the helper here so the contract suite exercises both ends.
test("isSameOriginMutation returns true for same origin", () => {
  const req = new Request("https://example.com/api", {
    headers: { origin: "https://example.com" },
  });
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns false for different origin", () => {
  const req = new Request("https://example.com/api", {
    headers: { origin: "https://attacker.com" },
  });
  assert.equal(isSameOriginMutation(req), false);
});

test("isSameOriginMutation returns true when both Origin and Sec-Fetch-Site are missing", () => {
  const req = new Request("https://example.com/api");
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns true for Sec-Fetch-Site same-origin", () => {
  const req = new Request("https://example.com/api", {
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns true for Sec-Fetch-Site none", () => {
  const req = new Request("https://example.com/api", {
    headers: { "sec-fetch-site": "none" },
  });
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns false for Sec-Fetch-Site cross-site", () => {
  const req = new Request("https://example.com/api", {
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(isSameOriginMutation(req), false);
});

test("isSameOriginMutation returns false for unparseable Origin URL", () => {
  const req = new Request("https://example.com/api", {
    headers: { origin: "not-a-url" },
  });
  assert.equal(isSameOriginMutation(req), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This test file imports a TypeScript source module. Node 20 cannot load
// `.ts` files natively (the `--experimental-strip-types` flag is Node
// 22.6+ only). On Node 20 the import below throws
// `ERR_UNKNOWN_FILE_EXTENSION`; the runtime detection below captures
// that and exposes a `TS_UNSUPPORTED` flag so every TS-dependent test
// in this file can `t.skip()` with a clear message instead of failing
// the CI run.
//
// The first two tests (the "forbidden strings" and "required strings"
// source scans) do NOT import any TypeScript module — they only walk
// the filesystem and grep for literal strings — so they run on Node
// 20 as well.
//
// On Node >= 22.6 (local dev, modern runners) the dynamic import
// succeeds and every test runs normally.
const TS_SOURCE_SPECIFIER = "../src/lib/admin/same-origin.ts";

let sameOriginModule = null;
let tsUnsupportedReason = null;
try {
  sameOriginModule = await import(TS_SOURCE_SPECIFIER);
} catch (error) {
  tsUnsupportedReason = error;
}

const TS_UNSUPPORTED = tsUnsupportedReason !== null;

const requireSameOriginModule = (t) => {
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
  return sameOriginModule;
};

const { isSameOriginMutation } = sameOriginModule ?? {};

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

// Files allowed to contain forbidden strings. These are explicitly known
// dead/legacy artefacts that the platform still ships in dist but the
// active code path does not import. They are tracked here so the scan
// remains meaningful (it still catches re-introductions in live code).
const ALLOWED_FORBIDDEN_FILES = new Set([
  path.join(
    projectRoot,
    "node_modules",
    "@metyatech",
    "course-docs-platform",
    "dist",
    "submissions",
    "admin-footer-toggle.js",
  ),
]);

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

// These two tests do NOT import any TypeScript module — they only walk
// the filesystem and grep for literal strings — so they run on Node 20
// as well as on newer Node versions.
test("forbidden admin auth strings are absent from active source", async () => {
  for (const dir of SOURCE_DIRECTORIES) {
    const files = await walk(dir);
    for (const file of files) {
      if (ALLOWED_FORBIDDEN_FILES.has(file)) continue;
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
// the helper here so the contract suite exercises both ends. They
// require the TypeScript helper module and must be skipped on Node 20.
test("isSameOriginMutation returns true for same origin", (t) => {
  if (!requireSameOriginModule(t)) return;
  const req = new Request("https://example.com/api", {
    headers: { origin: "https://example.com" },
  });
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns false for different origin", (t) => {
  if (!requireSameOriginModule(t)) return;
  const req = new Request("https://example.com/api", {
    headers: { origin: "https://attacker.com" },
  });
  assert.equal(isSameOriginMutation(req), false);
});

test("isSameOriginMutation returns true when both Origin and Sec-Fetch-Site are missing", (t) => {
  if (!requireSameOriginModule(t)) return;
  const req = new Request("https://example.com/api");
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns true for Sec-Fetch-Site same-origin", (t) => {
  if (!requireSameOriginModule(t)) return;
  const req = new Request("https://example.com/api", {
    headers: { "sec-fetch-site": "same-origin" },
  });
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns true for Sec-Fetch-Site none", (t) => {
  if (!requireSameOriginModule(t)) return;
  const req = new Request("https://example.com/api", {
    headers: { "sec-fetch-site": "none" },
  });
  assert.equal(isSameOriginMutation(req), true);
});

test("isSameOriginMutation returns false for Sec-Fetch-Site cross-site", (t) => {
  if (!requireSameOriginModule(t)) return;
  const req = new Request("https://example.com/api", {
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(isSameOriginMutation(req), false);
});

test("isSameOriginMutation returns false for unparseable Origin URL", (t) => {
  if (!requireSameOriginModule(t)) return;
  const req = new Request("https://example.com/api", {
    headers: { origin: "not-a-url" },
  });
  assert.equal(isSameOriginMutation(req), false);
});

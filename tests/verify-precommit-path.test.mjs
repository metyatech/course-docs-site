import assert from "node:assert/strict";
import test from "node:test";
import { getNpmInvocation } from "../packages/platform/scripts/npm-invocation.mjs";
import { normalizeNpmPathEnv, normalizePathEntries } from "../scripts/verify-precommit-path.mjs";

test("npm PATH normalization removes duplicates and keeps every unique entry in order", () => {
  assert.equal(
    normalizePathEntries("C:\\tools;C:\\repo\\node_modules\\.bin;C:\\tools;C:\\Windows", "win32"),
    "C:\\tools;C:\\repo\\node_modules\\.bin;C:\\Windows",
  );
});

test("Windows PATH normalization preserves the existing variable name", () => {
  assert.deepEqual(
    normalizeNpmPathEnv({ Path: "C:\\node;C:\\node", npm_execpath: "npm-cli.js" }, "win32"),
    { Path: "C:\\node", npm_execpath: "npm-cli.js" },
  );
});

test("Windows PATH normalization reduces nested npm duplication below the cmd limit", () => {
  const repeatedBin = "C:\\repo\\node_modules\\.bin";
  const originalEntries = [
    ...Array.from({ length: 400 }, () => repeatedBin),
    "C:\\Program Files\\nodejs",
    "C:\\Windows\\System32",
    "C:\\Windows",
  ];
  const originalPath = originalEntries.join(";");
  const normalizedPath = normalizePathEntries(originalPath, "win32");

  assert.ok(
    originalPath.length > 8191,
    "the nested npm fixture must exceed cmd.exe's command environment limit",
  );
  assert.ok(normalizedPath.length < 8191, "deduplication must put the path below cmd.exe's limit");
  assert.deepEqual(normalizedPath.split(";"), [
    repeatedBin,
    "C:\\Program Files\\nodejs",
    "C:\\Windows\\System32",
    "C:\\Windows",
  ]);
});

test("Windows PATH normalization retains quoted and spaced entries and the first empty entry", () => {
  assert.equal(
    normalizePathEntries(
      ';C:\\Program Files\\nodejs;"C:\\Program Files\\nodejs";C:\\tools;C:\\tools;c:\\TOOLS;;',
      "win32",
    ),
    ';C:\\Program Files\\nodejs;"C:\\Program Files\\nodejs";C:\\tools',
  );
});

test("Windows npm invocation gives cmd /c one command string", () => {
  assert.deepEqual(getNpmInvocation(["run", "build"], "win32"), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "npm run build"],
  });
});

test("non-Windows npm invocation keeps the direct npm argument list", () => {
  assert.deepEqual(getNpmInvocation(["run", "build"], "linux"), {
    command: "npm",
    args: ["run", "build"],
  });
});

test("non-Windows PATH normalization remains case-sensitive", () => {
  assert.equal(
    normalizePathEntries("/usr/bin:/usr/local/bin:/usr/bin", "linux"),
    "/usr/bin:/usr/local/bin",
  );
});

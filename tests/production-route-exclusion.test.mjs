import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.COURSE_DOCS_NEXT_DIST_DIR?.trim() || ".next";

const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.join(projectRoot, distDir, relativePath), "utf8"));

const allStrings = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
};

test("production manifests do not discover tutorial-shots routes", async () => {
  const manifestPaths = [
    "routes-manifest.json",
    "server/app-paths-manifest.json",
    "server/middleware-manifest.json",
  ];
  const manifestText = (await Promise.all(manifestPaths.map(readJson))).flatMap(allStrings).join("\n");

  assert.doesNotMatch(manifestText, /(?:^|[/\\])dev[/\\]tutorial-shots/);
  assert.doesNotMatch(manifestText, /api[/\\]dev[/\\]tutorial-shots/);
});

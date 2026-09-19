import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.COURSE_DOCS_NEXT_DIST_DIR?.trim() || ".next";

const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.join(projectRoot, distDir, relativePath), "utf8"));

const listFiles = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(filePath) : [filePath];
    }),
  );
  return nested.flat();
};

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
  const manifestText = (await Promise.all(manifestPaths.map(readJson)))
    .flatMap(allStrings)
    .join("\n");

  assert.doesNotMatch(manifestText, /(?:^|[/\\])dev[/\\]tutorial-shots/);
  assert.doesNotMatch(manifestText, /api[/\\]dev[/\\]tutorial-shots/);
});

test("production function traces do not include synchronized course source files", async () => {
  const serverRoot = path.join(projectRoot, distDir, "server");
  const contentRoot = path.join(projectRoot, "content");
  const traceFiles = (await listFiles(serverRoot)).filter((filePath) =>
    filePath.endsWith(".nft.json"),
  );
  const tracedContentFiles = [];

  for (const traceFile of traceFiles) {
    const trace = JSON.parse(await fs.readFile(traceFile, "utf8"));
    for (const tracedPath of trace.files ?? []) {
      const absolutePath = path.resolve(path.dirname(traceFile), tracedPath);
      const relativePath = path.relative(contentRoot, absolutePath);
      if (
        relativePath !== "" &&
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
      ) {
        tracedContentFiles.push(`${path.relative(projectRoot, traceFile)} -> ${relativePath}`);
      }
    }
  }

  assert.ok(traceFiles.length > 0, "production build must generate function trace files");
  assert.deepEqual(
    tracedContentFiles,
    [],
    "synchronized content and its assets must stay in static output, outside Functions",
  );
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("direct course assets use the generated public static namespace", async () => {
  const nextConfig = await fs.readFile(path.join(projectRoot, "next.config.js"), "utf8");
  const middlewareSource = await fs.readFile(
    path.join(projectRoot, "packages", "platform", "src", "next-app", "middleware.ts"),
    "utf8",
  );
  const platformPackage = JSON.parse(
    await fs.readFile(path.join(projectRoot, "packages", "platform", "package.json"), "utf8"),
  );

  assert.doesNotMatch(nextConfig, /outputFileTracingIncludes/);
  assert.doesNotMatch(nextConfig, /content\/\*\*\/\*/);
  assert.match(middlewareSource, /_course-assets\$\{pathname\}/);
  assert.equal(platformPackage.exports["./next-app/asset-route"], undefined);
  assert.equal(
    await fs.stat(path.join(projectRoot, "src", "app", "asset", "[...assetPath]", "route.ts"))
      .then(() => true)
      .catch(() => false),
    false,
  );
});

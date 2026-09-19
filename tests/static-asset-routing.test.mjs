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
  assert.match(middlewareSource, /getCourseAssetRewritePath/);
  assert.doesNotMatch(middlewareSource, /DIRECT_ROUTE_ASSET_EXTENSION_SET/);
  assert.equal(platformPackage.exports["./next-app/asset-route"], undefined);
  assert.equal(
    await fs
      .stat(path.join(projectRoot, "src", "app", "asset", "[...assetPath]", "route.ts"))
      .then(() => true)
      .catch(() => false),
    false,
  );
});

test("middleware route policy rewrites unknown assets but leaves source and pages alone", async () => {
  const { getCourseAssetRewritePath } =
    await import("../packages/platform/dist/shared/course-asset-config.js");

  for (const pathname of [
    "/docs/test/model.glb",
    "/docs/test/project.uasset",
    "/docs/test/file.foo",
  ]) {
    assert.equal(getCourseAssetRewritePath(pathname), `/_course-assets${pathname}`);
  }

  for (const pathname of [
    "/docs/test/README.md",
    "/docs/test/index.mdx",
    "/docs/_meta.ts",
    "/docs/.env.local",
    "/docs/private.pem",
    "/docs/secret.key",
    "/docs/test/page",
    "/docs/test/shots/example.raw.png",
    "/docs/test/shots/example.shot.json",
    "/docs/css-basics/css-styling-basics/assets/css-styling-basics-complete/model.glb",
  ]) {
    assert.equal(getCourseAssetRewritePath(pathname), undefined, pathname);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const nextConfigUrl = pathToFileURL(path.resolve("next.config.js"));

const importNextConfig = async (envOverrides = {}) => {
  const previous = {
    COURSE_DOCS_SKIP_BUILD_LINT: process.env.COURSE_DOCS_SKIP_BUILD_LINT,
    COURSE_DOCS_SKIP_BUILD_TYPECHECK: process.env.COURSE_DOCS_SKIP_BUILD_TYPECHECK,
  };

  for (const [key, value] of Object.entries(envOverrides)) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }

  const importUrl = new URL(nextConfigUrl.href);
  importUrl.searchParams.set("ts", `${Date.now()}-${Math.random()}`);

  try {
    const importedConfig = await import(importUrl.href);
    return importedConfig.default;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (typeof value === "string") {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  }
};

const createWebpackConfig = () => ({
  watchOptions: {
    ignored: /(\.(git|next)|node_modules)/,
  },
  module: {
    rules: [{ oneOf: [{ test: /\.css$/i }] }],
  },
  output: {
    path: "/tmp/out",
  },
  resolve: {
    alias: {},
    modules: [],
  },
});

test("next config disables static image wrappers for course asset imports", async () => {
  const nextConfig = await importNextConfig();
  assert.equal(nextConfig.images?.disableStaticImages, true);
  assert.equal(nextConfig.images?.unoptimized, true);
});

test("next build keeps lint and typecheck enabled by default", async () => {
  const nextConfig = await importNextConfig();
  assert.equal(nextConfig.eslint?.ignoreDuringBuilds, false);
  assert.equal(nextConfig.typescript?.ignoreBuildErrors, false);
});

test("next dev allows 127.0.0.1 as an additional local origin", async () => {
  const nextConfig = await importNextConfig();
  assert.ok(Array.isArray(nextConfig.allowedDevOrigins));
  assert.ok(nextConfig.allowedDevOrigins.includes("127.0.0.1"));
});

test("verified builds can skip duplicate lint and typecheck passes", async () => {
  const nextConfig = await importNextConfig({
    COURSE_DOCS_SKIP_BUILD_LINT: "1",
    COURSE_DOCS_SKIP_BUILD_TYPECHECK: "1",
  });
  assert.equal(nextConfig.eslint?.ignoreDuringBuilds, true);
  assert.equal(nextConfig.typescript?.ignoreBuildErrors, true);
});

test("next config treats arbitrary files inside content assets directories as resource assets", async () => {
  const nextConfig = await importNextConfig();
  const updated = nextConfig.webpack(createWebpackConfig(), {
    isServer: false,
    defaultLoaders: { babel: {} },
  });
  const arbitraryAssetRule = updated.module.rules.find(
    (rule) =>
      rule?.type === "asset/resource" &&
      rule.test instanceof RegExp &&
      rule.test.source === /[\\/]content[\\/].*[\\/]assets[\\/]/i.source &&
      rule.test.flags === "i",
  );

  assert.ok(arbitraryAssetRule, "Expected a fallback resource rule for content/**/assets/** paths.");
  assert.match("/tmp/project/content/docs/models/assets/Item.fbx", arbitraryAssetRule.test);
  assert.doesNotMatch("/tmp/project/content/docs/models/Item.fbx", arbitraryAssetRule.test);
  assert.match("theme.css", arbitraryAssetRule.exclude);
});

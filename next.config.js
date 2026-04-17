import path from "node:path";
import { fileURLToPath } from "node:url";
import nextra from "nextra";
import {
  applyCourseAssetWebpackRules,
  courseMdxOptions,
} from "@metyatech/course-docs-platform/next";
import { resolveNextDistDir, resolveNextDistDirPath } from "./scripts/next-dist-dir.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const skipBuildLint = process.env.COURSE_DOCS_SKIP_BUILD_LINT === "1";
const skipBuildTypecheck = process.env.COURSE_DOCS_SKIP_BUILD_TYPECHECK === "1";
const contentAssetPathPattern = /[\\/]content[\\/].*[\\/]assets[\\/]/i;

const withNextra = nextra({
  defaultShowCopyCode: true,
  search: {
    codeblocks: false,
  },
  staticImage: false,
  mdxOptions: {
    ...courseMdxOptions,
  },
});

const hasArbitraryAssetDirectoryRule = (config) =>
  config.module.rules.some(
    (rule) =>
      rule?.type === "asset/resource" &&
      rule.test instanceof RegExp &&
      rule.test.source === contentAssetPathPattern.source &&
      rule.test.flags === contentAssetPathPattern.flags,
  );

const applyArbitraryAssetDirectoryFallbackRule = (config, { isServer }) => {
  if (hasArbitraryAssetDirectoryRule(config)) {
    return config;
  }

  const nextOutputRoot = resolveNextDistDirPath({ projectRoot, env: process.env });
  const staticMediaOutputPath = isServer
    ? path.relative(config.output.path, nextOutputRoot)
    : undefined;

  config.module.rules.push({
    test: contentAssetPathPattern,
    exclude: /\.css$/i,
    type: "asset/resource",
    generator: {
      filename: "static/media/[name].[hash][ext]",
      publicPath: "/_next/",
      outputPath: staticMediaOutputPath,
    },
  });

  return config;
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: resolveNextDistDir({ projectRoot, env: process.env }),
  reactStrictMode: true,
  trailingSlash: true,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@metyatech/course-docs-platform"],
  eslint: {
    ignoreDuringBuilds: skipBuildLint,
  },
  typescript: {
    ignoreBuildErrors: skipBuildTypecheck,
  },
  outputFileTracingIncludes: {
    // Ensure /asset route can read synced course files in serverless runtimes.
    "/asset/[...assetPath]": ["content/**/*"],
    "/asset/[...assetPath]/route": ["content/**/*"],
    "/asset": ["content/**/*"],
  },
  env: {
    NEXT_PUBLIC_WORKS_BASE_URL: process.env.NEXT_PUBLIC_WORKS_BASE_URL ?? "",
  },
  images: {
    unoptimized: true,
    disableStaticImages: true,
  },
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.symlinks = false;

    // Ensures that when course-docs-platform is linked locally (npm link),
    // its devDependencies (peerDeps like nextra-theme-docs, react) resolve from
    // this project's node_modules rather than the linked package's own node_modules,
    // preventing duplicate React Context singleton issues.
    const rootNodeModules = path.join(projectRoot, "node_modules");
    config.resolve.modules = [...(config.resolve.modules ?? [])];
    if (!config.resolve.modules.includes(rootNodeModules)) {
      config.resolve.modules.unshift(rootNodeModules);
    }

    applyCourseAssetWebpackRules(config, { isServer, projectRoot });
    return applyArbitraryAssetDirectoryFallbackRule(config, { isServer });
  },
};

export default withNextra(nextConfig);

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextra from 'nextra';
import { applyCourseAssetWebpackRules, courseMdxOptions } from '@metyatech/course-docs-platform/next';

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  transpilePackages: ['@metyatech/course-docs-platform'],
  env: {
    NEXT_PUBLIC_WORKS_BASE_URL: process.env.NEXT_PUBLIC_WORKS_BASE_URL ?? '',
  },
  images: {
    unoptimized: true,
  },
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.symlinks = false;

    // Course content may live outside the project root (linked into `content/`).
    // Ensure webpack can still resolve packages from this app's node_modules.
    const projectRoot = fileURLToPath(new URL('.', import.meta.url));
    const rootNodeModules = path.join(projectRoot, 'node_modules');
    config.resolve.modules = [...(config.resolve.modules ?? [])];
    if (!config.resolve.modules.includes(rootNodeModules)) {
      config.resolve.modules.push(rootNodeModules);
    }

    return applyCourseAssetWebpackRules(config, { isServer, projectRoot });
  },
};

export default withNextra(nextConfig);

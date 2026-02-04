import { fileURLToPath } from 'node:url';
import nextra from 'nextra';
import { applyCourseAssetWebpackRules, courseMdxOptions } from '@metyatech/course-docs-platform/next';

const withNextra = nextra({
  defaultShowCopyCode: true,
  search: {
    codeblocks: false,
  },
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

    const projectRoot = fileURLToPath(new URL('.', import.meta.url));
    return applyCourseAssetWebpackRules(config, { isServer, projectRoot });
  },
};

export default withNextra(nextConfig);

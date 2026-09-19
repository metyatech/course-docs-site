import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const configModulePath = '../dist/shared/course-asset-config.js';
const downloadUrlModulePath = '../dist/mdx/create-course-download-url.js';
const downloadRouteModulePath = '../dist/next-app/download-asset-route.js';
const webpackModulePath = '../dist/next/apply-course-asset-webpack.js';
const shouldIgnoreModulePath = '../dist/next-app/should-ignore-mdx-path.js';

test('importable asset extensions include pdf and common video files', async () => {
  const { IMPORTABLE_STATIC_ASSET_EXTENSIONS, createAssetExtensionRegex } = await import(
    configModulePath
  );

  assert.ok(IMPORTABLE_STATIC_ASSET_EXTENSIONS.includes('.pdf'));
  assert.ok(IMPORTABLE_STATIC_ASSET_EXTENSIONS.includes('.mp4'));
  assert.ok(IMPORTABLE_STATIC_ASSET_EXTENSIONS.includes('.mov'));
  assert.ok(IMPORTABLE_STATIC_ASSET_EXTENSIONS.includes('.webm'));

  const regex = createAssetExtensionRegex(IMPORTABLE_STATIC_ASSET_EXTENSIONS);
  assert.match('handout.pdf', regex);
  assert.match('lesson.mp4', regex);
  assert.match('clip.mov', regex);
  assert.match('teaser.webm', regex);
  assert.doesNotMatch('script.js', regex);
});

test('shared content types cover pdf and video assets', async () => {
  const { getCourseAssetContentType, isPublishableCourseAssetPath } = await import(
    configModulePath
  );

  assert.equal(getCourseAssetContentType('.pdf'), 'application/pdf');
  assert.equal(getCourseAssetContentType('.mp4'), 'video/mp4');
  assert.equal(getCourseAssetContentType('.mov'), 'video/quicktime');
  assert.equal(getCourseAssetContentType('.webm'), 'video/webm');

  assert.equal(isPublishableCourseAssetPath('docs/handout.pdf'), true);
  assert.equal(isPublishableCourseAssetPath('docs/movie.mp4'), true);
});

test('course asset publication defaults to static except source and private files', async () => {
  const { isPublishableCourseAssetPath } = await import(configModulePath);

  for (const relativePath of [
    'docs/model.foo',
    'docs/model.glb',
    'docs/project.uasset',
    'docs/code.js',
  ]) {
    assert.equal(isPublishableCourseAssetPath(relativePath), true, relativePath);
  }

  for (const relativePath of [
    'docs/index.mdx',
    'README.md',
    '_meta.ts',
    'docs/_meta.js',
    'docs/_meta.mjs',
    'docs/_meta.cjs',
    '.env',
    '.env.local',
    'docs/.private/image.png',
    'private.pem',
    'secret.key',
    'bundle.p12',
    'certificate.pfx',
    'docs/student-guide/shots/example.raw.png',
    'docs/student-guide/shots/example.shot.json',
    'docs/models/../secret.png',
    'docs/%2Eenv.local',
    'docs/css-basics/css-styling-basics/assets/css-styling-basics-complete/model.glb',
    'docs/html-basics/images-links/assets/images-links-complete/model.glb',
    'docs/html-basics/practice-exercises/markup-exercises-advanced/assets/markup-exercises-advanced-complete/model.glb',
    'docs/html-basics/text-markup/assets/text-markup-complete/model.glb',
  ]) {
    assert.equal(isPublishableCourseAssetPath(relativePath), false, relativePath);
  }
});

test('course asset rewrite paths accept any file extension without capturing pages', async () => {
  const { getCourseAssetRewritePath } = await import(configModulePath);

  assert.equal(
    getCourseAssetRewritePath('/docs/test/model.glb'),
    '/_course-assets/docs/test/model.glb',
  );
  assert.equal(
    getCourseAssetRewritePath('/docs/test/project.uasset'),
    '/_course-assets/docs/test/project.uasset',
  );
  assert.equal(
    getCourseAssetRewritePath('/docs/test/file.foo'),
    '/_course-assets/docs/test/file.foo',
  );
  assert.equal(getCourseAssetRewritePath('/docs/test/page'), undefined);
  assert.equal(getCourseAssetRewritePath('/docs/test/page.'), undefined);
  assert.equal(getCourseAssetRewritePath('/docs/test/page.mdx'), undefined);
  assert.equal(getCourseAssetRewritePath('/docs/test/_meta.ts'), undefined);
  assert.equal(getCourseAssetRewritePath('/docs/test/.env'), undefined);
  assert.equal(getCourseAssetRewritePath('/outside/file.foo'), undefined);
});

test('webpack asset rule matches pdf and video assets', async () => {
  const { applyCourseAssetWebpackRules } = await import(webpackModulePath);

  const config = {
    module: {
      rules: [{ oneOf: [{ test: /\.css$/i }] }],
    },
    output: {
      path: '/tmp/out',
    },
  };

  const updated = applyCourseAssetWebpackRules(config, {
    isServer: false,
    projectRoot: '/tmp/project',
  });

  const extensionRule = updated.module.rules.at(-2);
  assert.ok(extensionRule?.test instanceof RegExp);
  assert.match('file.pdf', extensionRule.test);
  assert.match('video.mp4', extensionRule.test);
  assert.match('clip.mov', extensionRule.test);
  assert.match('preview.webm', extensionRule.test);
  assert.doesNotMatch('script.js', extensionRule.test);
});

test('webpack asset rule matches arbitrary assets inside content asset directories', async () => {
  const { applyCourseAssetWebpackRules } = await import(webpackModulePath);

  const config = {
    module: {
      rules: [{ oneOf: [{ test: /\.css$/i }] }],
    },
    output: {
      path: '/tmp/out',
    },
  };

  const updated = applyCourseAssetWebpackRules(config, {
    isServer: false,
    projectRoot: '/tmp/project',
  });

  const assetDirectoryRule = updated.module.rules.at(-1);
  assert.ok(assetDirectoryRule?.test instanceof RegExp);
  assert.match('/tmp/project/content/docs/models/assets/item.fbx', assetDirectoryRule.test);
  assert.match(
    'C:\\tmp\\project\\content\\docs\\models\\assets\\item.blend',
    assetDirectoryRule.test,
  );
  assert.doesNotMatch('/tmp/project/content/docs/models/item.fbx', assetDirectoryRule.test);

  if (!(assetDirectoryRule?.exclude instanceof RegExp)) {
    throw new Error('Expected arbitrary asset directory rule to exclude css files.');
  }

  assert.match('style.css', assetDirectoryRule.exclude);
});

test('webpack asset rule honors custom Next dist dirs for server output', async () => {
  const { applyCourseAssetWebpackRules } = await import(webpackModulePath);
  const originalDistDir = process.env.COURSE_DOCS_NEXT_DIST_DIR;
  const projectRoot = '/tmp/project';
  const distDir = '.next-test/custom-server';
  const config = {
    module: {
      rules: [{ oneOf: [{ test: /\.css$/i }] }],
    },
    output: {
      path: path.join(projectRoot, '.next-test', 'custom-server', 'server', 'app'),
    },
  };

  process.env.COURSE_DOCS_NEXT_DIST_DIR = distDir;

  try {
    const updated = applyCourseAssetWebpackRules(config, {
      isServer: true,
      projectRoot,
    });

    const assetRule = updated.module.rules.at(-2);
    assert.equal(
      assetRule?.generator?.outputPath,
      path.relative(config.output.path, path.join(projectRoot, '.next-test', 'custom-server')),
    );
  } finally {
    if (typeof originalDistDir === 'string') {
      process.env.COURSE_DOCS_NEXT_DIST_DIR = originalDistDir;
    } else {
      delete process.env.COURSE_DOCS_NEXT_DIST_DIR;
    }
  }
});

test('mdx routing ignores pdf and video files as static assets', async () => {
  const { shouldIgnoreMdxPath } = await import(shouldIgnoreModulePath);

  assert.equal(shouldIgnoreMdxPath(['docs', 'handout.pdf']), true);
  assert.equal(shouldIgnoreMdxPath(['docs', 'movie.mp4']), true);
  assert.equal(shouldIgnoreMdxPath(['docs', 'clip.mov']), true);
  assert.equal(shouldIgnoreMdxPath(['docs', 'preview.webm']), true);
});

test('download helper wraps imported asset urls with a stable filename route', async () => {
  const { createCourseDownloadUrl } = await import(downloadUrlModulePath);

  assert.equal(
    createCourseDownloadUrl('/_next/static/media/%E5%8E%9F%E7%A8%BF.123.txt', '原稿.txt'),
    '/download-asset/?src=%2F_next%2Fstatic%2Fmedia%2F%25E5%258E%259F%25E7%25A8%25BF.123.txt&filename=%E5%8E%9F%E7%A8%BF.txt',
  );
  assert.equal(
    createCourseDownloadUrl('https://example.com/file.txt', 'file.txt'),
    'https://example.com/file.txt',
  );
  assert.equal(
    createCourseDownloadUrl('/_next/static/media/file.txt', ''),
    '/_next/static/media/file.txt',
  );
});

test('download asset route proxies allowed sources with attachment filename headers', async () => {
  const { GET } = await import(downloadRouteModulePath);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('hello world', {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: '"fixture"',
      },
    });

  try {
    const response = await GET(
      new Request(
        'https://example.com/download-asset?src=%2F_next%2Fstatic%2Fmedia%2F%25E5%258E%259F%25E7%25A8%25BF.123.txt&filename=%E5%8E%9F%E7%A8%BF.txt',
      ),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(
      response.headers.get('content-disposition'),
      `attachment; filename="_.txt"; filename*=UTF-8''${encodeURIComponent('原稿.txt')}`,
    );
    assert.equal(await response.text(), 'hello world');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('download asset route rejects unsupported sources', async () => {
  const { GET } = await import(downloadRouteModulePath);

  const response = await GET(
    new Request('https://example.com/download-asset?src=%2Fdocs%2Fsecret.txt&filename=secret.txt'),
  );

  assert.equal(response.status, 404);
});

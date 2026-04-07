import assert from 'node:assert/strict';
import test from 'node:test';

const configModulePath = '../dist/shared/course-asset-config.js';
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
  const { getCourseAssetContentType, DIRECT_ROUTE_ASSET_EXTENSION_SET } = await import(
    configModulePath
  );

  assert.equal(getCourseAssetContentType('.pdf'), 'application/pdf');
  assert.equal(getCourseAssetContentType('.mp4'), 'video/mp4');
  assert.equal(getCourseAssetContentType('.mov'), 'video/quicktime');
  assert.equal(getCourseAssetContentType('.webm'), 'video/webm');

  assert.equal(DIRECT_ROUTE_ASSET_EXTENSION_SET.has('.pdf'), true);
  assert.equal(DIRECT_ROUTE_ASSET_EXTENSION_SET.has('.mp4'), true);
  assert.equal(DIRECT_ROUTE_ASSET_EXTENSION_SET.has('.mov'), true);
  assert.equal(DIRECT_ROUTE_ASSET_EXTENSION_SET.has('.webm'), true);
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

  const assetRule = updated.module.rules.at(-1);
  assert.ok(assetRule?.test instanceof RegExp);
  assert.match('file.pdf', assetRule.test);
  assert.match('video.mp4', assetRule.test);
  assert.match('clip.mov', assetRule.test);
  assert.match('preview.webm', assetRule.test);
  assert.doesNotMatch('script.js', assetRule.test);
});

test('mdx routing ignores pdf and video files as static assets', async () => {
  const { shouldIgnoreMdxPath } = await import(shouldIgnoreModulePath);

  assert.equal(shouldIgnoreMdxPath(['docs', 'handout.pdf']), true);
  assert.equal(shouldIgnoreMdxPath(['docs', 'movie.mp4']), true);
  assert.equal(shouldIgnoreMdxPath(['docs', 'clip.mov']), true);
  assert.equal(shouldIgnoreMdxPath(['docs', 'preview.webm']), true);
});

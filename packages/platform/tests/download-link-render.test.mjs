import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const downloadLinkModulePath = '../dist/mdx/DownloadLink.js';

test('DownloadLink renders a stable-filename download href and defaults its label', async () => {
  const { default: DownloadLink } = await import(downloadLinkModulePath);

  const html = renderToStaticMarkup(
    React.createElement(DownloadLink, {
      file: '/_next/static/media/%E5%8E%9F%E7%A8%BF.123.txt',
      filename: '原稿.txt',
      className: 'download-link',
    }),
  );

  assert.match(html, /href="\/download-asset\/\?src=/);
  assert.match(html, /filename=%E5%8E%9F%E7%A8%BF\.txt/);
  assert.match(html, /download="原稿\.txt"/);
  assert.match(html, /class="download-link"/);
  assert.match(html, />原稿\.txt<\/a>$/);
});

test('DownloadLink preserves custom children', async () => {
  const { default: DownloadLink } = await import(downloadLinkModulePath);

  const html = renderToStaticMarkup(
    React.createElement(
      DownloadLink,
      {
        file: '/_next/static/media/example.zip',
        filename: 'example.zip',
      },
      '完成形をダウンロード',
    ),
  );

  assert.match(html, />完成形をダウンロード<\/a>$/);
});

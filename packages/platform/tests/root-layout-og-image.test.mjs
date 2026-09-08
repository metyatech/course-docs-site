import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const rootLayoutModulePath = '../dist/next-app/create-root-layout.js';

const loaderSource = [
  'export async function resolve(specifier, context, nextResolve) {',
  "  if (specifier === 'nextra/components') {",
  "    return { url: 'data:text/javascript,export%20const%20Head%20%3D%20(%7B%20children%20%7D)%20%3D%3E%20children%3B', shortCircuit: true };",
  '  }',
  '',
  '  try {',
  '    return await nextResolve(specifier, context);',
  '  } catch (error) {',
  "    if (!specifier.endsWith('.js')) {",
  "      return nextResolve(specifier + '.js', context);",
  '    }',
  '',
  '    throw error;',
  '  }',
  '}',
  '',
  'export async function load(url, context, nextLoad) {',
  "  if (url.endsWith('.css')) {",
  "    return { format: 'module', source: 'export default {}', shortCircuit: true };",
  '  }',
  '',
  '  return nextLoad(url, context);',
  '}',
].join('\n');

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const renderRootLayout = (options) =>
  renderToStaticMarkup(
    React.createElement(
      options.createRootLayout(options),
      null,
      React.createElement('main', null, 'content'),
    ),
  );

test('createRootLayout renders OGP image metadata with the existing description and favicon', async () => {
  const { createRootLayout } = await import(rootLayoutModulePath);
  const ogImageUrl = 'https://example.com/ogp.png';

  const html = renderRootLayout({
    createRootLayout,
    description: 'Existing description',
    faviconHref: '/img/favicon.ico',
    ogImageUrl: `  ${ogImageUrl}  `,
  });

  assert.equal((html.match(/property="og:image"/g) ?? []).length, 1);
  assert.match(html, new RegExp(`property="og:image" content="${ogImageUrl}"`));
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, new RegExp(`name="twitter:image" content="${ogImageUrl}"`));
  assert.match(html, /name="description" content="Existing description"/);
  assert.match(html, /rel="icon" href="\/img\/favicon\.ico"/);
});

test('createRootLayout omits image metadata when OGP image URL is not configured', async () => {
  const { createRootLayout } = await import(rootLayoutModulePath);

  const html = renderRootLayout({
    createRootLayout,
    description: 'Existing description',
    faviconHref: '/img/favicon.ico',
  });

  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /name="twitter:card"/);
  assert.doesNotMatch(html, /name="twitter:image"/);
});

test('createRootLayout omits image metadata when OGP image URL is whitespace only', async () => {
  const { createRootLayout } = await import(rootLayoutModulePath);

  const html = renderRootLayout({
    createRootLayout,
    description: 'Existing description',
    faviconHref: '/img/favicon.ico',
    ogImageUrl: ' \t\n ',
  });

  assert.doesNotMatch(html, /property="og:image"/);
  assert.doesNotMatch(html, /name="twitter:card"/);
  assert.doesNotMatch(html, /name="twitter:image"/);
});

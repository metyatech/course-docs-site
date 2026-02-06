import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = async (relativePath) =>
  fs.readFile(path.join(projectRoot, relativePath), 'utf8');

test('site mdx-components only composes platform mdx components', async () => {
  const source = await read('src/mdx-components.tsx');

  assert.doesNotMatch(source, /@metyatech\/code-preview/);
  assert.match(source, /createUseMDXComponents\(\)/);
});

test('site package does not own code-preview dependency', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const deps = pkg.dependencies ?? {};

  assert.equal(
    Object.prototype.hasOwnProperty.call(deps, '@metyatech/code-preview'),
    false
  );
});

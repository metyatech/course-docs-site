import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('next config includes content tracing for asset route', async () => {
  const configPath = path.join(projectRoot, 'next.config.js');
  const configSource = await fs.readFile(configPath, 'utf8');

  assert.match(configSource, /outputFileTracingIncludes\s*:/);
  assert.match(configSource, /['"]\/asset\/\[\.\.\.assetPath\]['"]\s*:/);
  assert.match(configSource, /['"]\/asset\/\[\.\.\.assetPath\]\/route['"]\s*:/);
  assert.match(configSource, /['"]content\/\*\*\/\*['"]/);
});

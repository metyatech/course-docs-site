import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('platform mdx components own server CodePreview binding', async () => {
  const source = await fs.readFile(
    path.join(projectRoot, 'src', 'mdx', 'create-use-mdx-components.tsx'),
    'utf8',
  );

  assert.match(source, /@metyatech\/code-preview\/server/);
  assert.doesNotMatch(source, /@metyatech\/code-preview\/client/);
});

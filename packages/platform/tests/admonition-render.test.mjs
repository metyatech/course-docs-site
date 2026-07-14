import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Admonition delegates rendering to Nextra Callout and keeps title markup hooks', async () => {
  const source = await fs.readFile(path.join(projectRoot, 'src', 'mdx', 'Admonition.tsx'), 'utf8');

  assert.match(source, /import \{ Callout \} from 'nextra\/components';/);
  assert.match(
    source,
    /<Callout type=\{CALLOUT_TYPE_BY_ADMONITION_TYPE\[resolvedType\]\}>\{content\}<\/Callout>/,
  );
  assert.match(source, /course-callout__title/);
  assert.doesNotMatch(source, /course-admonition/);
});

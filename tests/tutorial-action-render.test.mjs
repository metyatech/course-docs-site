import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const actionSourcePath = path.join(projectRoot, 'src', 'mdx', 'tutorial', 'Action.tsx');

test('Action uses Nextra ImageZoom for tutorial images', async () => {
  const source = await fs.readFile(actionSourcePath, 'utf8');

  assert.match(source, /import \{ ImageZoom \} from 'nextra\/components';/);
  assert.match(
    source,
    /<ImageZoom src=\{img\} alt=\{alt \?\? ''\} className="tutorial-action__img" loading="lazy" \/>/,
  );
  assert.doesNotMatch(source, /<img[\s>]/);
});

test('Action keeps the tutorial text container alongside the optional image', async () => {
  const source = await fs.readFile(actionSourcePath, 'utf8');

  assert.match(source, /img\?: string;/);
  assert.match(source, /<div className="tutorial-action__text">\{children\}<\/div>/);
});

test('Action delegates numbered callouts to tutorial-shots (no overlay surface)', async () => {
  const source = await fs.readFile(actionSourcePath, 'utf8');

  // Callouts are the responsibility of the tutorial-shots dev editor,
  // which bakes annotations into the published image. The Action
  // component must NOT offer its own overlay surface, which would
  // encourage authors to hand-write pixel coordinates in MDX.
  assert.doesNotMatch(source, /ActionCallout/);
  assert.doesNotMatch(source, /callouts\?:/);
  assert.doesNotMatch(source, /tutorial-action__callouts?/);
  assert.doesNotMatch(source, /tutorial-action__img-wrapper/);
});

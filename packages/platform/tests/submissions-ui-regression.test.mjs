import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = async (relativePath) => fs.readFile(path.join(projectRoot, relativePath), 'utf8');

test('submissions preview keeps click-to-open behavior', async () => {
  const source = await read('src/submissions/submissions-client.tsx');

  assert.match(source, /styles\.iframeWrapper/);
  assert.match(source, /window\.open\(workUrl,\s*['_"]_blank['"]\)/);
  assert.match(source, /data-testid=\{`work-preview-\$\{work\.studentId\}`\}/);
});

test('comment author tooltip is shown per row only', async () => {
  const commentsSource = await read('src/submissions/work-comments.tsx');
  const cssSource = await read('src/submissions/submissions.module.css');

  assert.doesNotMatch(commentsSource, /nameVisible/);
  assert.match(commentsSource, /styles\.commentAuthorName/);
  assert.match(cssSource, /\.commentAuthorToggle:hover ~ \.commentAuthorName/);
  assert.match(cssSource, /\.commentAuthorToggle:focus-visible ~ \.commentAuthorName/);
});

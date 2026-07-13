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
  assert.doesNotMatch(source, /CourseCodePreview/);
  assert.match(source, /DownloadLink/);
});

test('course styles scope CodePreview shell to the resolved site theme', async () => {
  const source = await fs.readFile(path.join(projectRoot, 'styles', 'course-site.css'), 'utf8');

  assert.match(source, /\[data-code-preview-theme='dark'\] \[class\*='codePreviewContainer'\]/);
  assert.match(source, /--cp-bg: #0f172a/);
  assert.match(source, /\[class\*='fileStructure'\]/);
  assert.match(source, /\[class\*='editorContainer'\]/);
  assert.match(source, /\[class\*='gyoButton'\]/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRenderedHtmlCssDocument } from '../dist/learning-v2/runtime/content-renderer.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');

test('runtime and engine preserve their import and persistence boundaries', () => {
  const runtimeSources = [
    'src/learning-v2/runtime/LearningV2StaticPlayer.tsx',
    'src/learning-v2/runtime/content-renderer.tsx',
    'src/learning-v2/runtime/index.ts',
  ].map(readSource);
  const engineSources = [
    'src/learning-v2/engine/evaluator.ts',
    'src/learning-v2/engine/static-policy.ts',
    'src/learning-v2/engine/static-state.ts',
  ].map(readSource);

  for (const source of runtimeSources) {
    assert.doesNotMatch(source, /from ['"][^'"]*(?:compiler|node:crypto)/);
    assert.doesNotMatch(source, /\b(?:localStorage|indexedDB)\b/);
  }
  for (const source of engineSources) {
    assert.doesNotMatch(source, /from ['"][^'"]*(?:react|next|supabase)/i);
    assert.doesNotMatch(source, /\b(?:localStorage|indexedDB|Date\.now|Math\.random)\b/);
  }
});

test('Activity sections keep internal IDs out of accessible names', () => {
  const playerSource = readSource('src/learning-v2/runtime/LearningV2StaticPlayer.tsx');

  assert.doesNotMatch(playerSource, /aria-label=\{activity\.id\}/);
  assert.match(playerSource, /data-activity-id=\{activity\.id\}/);
});

test('HTML/CSS preview is sandboxed and blocks network-capable resources', () => {
  const rendererSource = readSource('src/learning-v2/runtime/content-renderer.tsx');
  const document = buildRenderedHtmlCssDocument('<p>preview</p>', 'p { color: red; }');

  assert.match(rendererSource, /sandbox=""/);
  assert.match(document, /http-equiv="Content-Security-Policy"/);
  assert.match(document, /default-src 'none'/);
  assert.match(document, /connect-src 'none'/);
  assert.match(document, /<p>preview<\/p>/);
  assert.match(document, /p \{ color: red; \}/);
  const playerStyles = fs.readFileSync(
    path.join(packageRoot, 'styles/course-learning-v2.css'),
    'utf8',
  );
  assert.match(playerStyles, /\.learning-v2__preview\s*\{[^}]*min-height:\s*22rem;/s);
});

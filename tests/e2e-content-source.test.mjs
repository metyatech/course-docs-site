import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContentSource } from '../scripts/content-source.mjs';

test('parses github source with explicit ref', () => {
  const parsed = parseContentSource('github:metyatech/programming-course-docs#main');
  assert.deepEqual(parsed, {
    kind: 'remote',
    repo: 'metyatech/programming-course-docs',
    ref: 'main',
  });
});

test('parses github source without ref using default main', () => {
  const parsed = parseContentSource('github:metyatech/javascript-course-docs');
  assert.deepEqual(parsed, {
    kind: 'remote',
    repo: 'metyatech/javascript-course-docs',
    ref: 'main',
  });
});

test('parses local relative path source', () => {
  const parsed = parseContentSource('../programming-course-docs');
  assert.deepEqual(parsed, {
    kind: 'local',
    localDir: '../programming-course-docs',
  });
});

test('rejects unsupported source format', () => {
  assert.throws(
    () => parseContentSource('metyatech/programming-course-docs#main'),
    /Invalid content source/
  );
});

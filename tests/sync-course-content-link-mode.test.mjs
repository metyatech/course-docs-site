import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldLinkLocalSource } from '../scripts/sync-course-content-mode.mjs';

test('local content sources stay linked during normal local development', () => {
  assert.equal(
    shouldLinkLocalSource({
      projectRoot: 'D:\\ghws\\course-docs-site',
      env: {},
    }),
    true,
  );
});

test('local content sources are copied inside Vercel build roots', () => {
  assert.equal(
    shouldLinkLocalSource({
      projectRoot: '/vercel/path0',
      env: {},
    }),
    false,
  );
});

test('local content sources are copied when Vercel env vars are present', () => {
  assert.equal(
    shouldLinkLocalSource({
      projectRoot: '/tmp/course-docs-site',
      env: { VERCEL: '1' },
    }),
    false,
  );
});

test('local content sources are copied when copy mode is forced', () => {
  assert.equal(
    shouldLinkLocalSource({
      projectRoot: 'D:\\ghws\\course-docs-site',
      env: { COURSE_DOCS_LOCAL_SOURCE_MODE: 'copy' },
    }),
    false,
  );
});

test('local content sources stay linked when link mode is forced', () => {
  assert.equal(
    shouldLinkLocalSource({
      projectRoot: 'D:\\ghws\\course-docs-site',
      env: { COURSE_DOCS_LOCAL_SOURCE_MODE: 'link' },
    }),
    true,
  );
});

test('Vercel safety wins even if link mode is forced', () => {
  assert.equal(
    shouldLinkLocalSource({
      projectRoot: '/vercel/path0',
      env: { COURSE_DOCS_LOCAL_SOURCE_MODE: 'link' },
    }),
    false,
  );
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('admin comment delete route reads ADMIN_MODE_TOKEN only', async () => {
  const source = await fs.readFile(
    path.join(projectRoot, 'src', 'next-app', 'admin-comment-delete-route.ts'),
    'utf8',
  );

  assert.match(source, /process\.env\.ADMIN_MODE_TOKEN/);
  assert.doesNotMatch(source, /process\.env\.ADMIN_DELETE_TOKEN/);
});

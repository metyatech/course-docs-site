import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientPath = path.join(projectRoot, 'src', 'submissions', 'submissions-client.tsx');
const legacySourcePath = path.join(projectRoot, 'src', 'submissions', 'admin-footer-toggle.tsx');
const legacyBuildPath = path.join(projectRoot, 'dist', 'submissions', 'admin-footer-toggle.js');
const packageJsonPath = path.join(projectRoot, 'package.json');

const {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  buildAdminCommentDeletePath,
  getAdminCommentDeleteFailure,
  readApiError,
} = await import('../dist/submissions/admin-comment-api.js');

const forbiddenFragments = [
  'admin-comment-token',
  'x-admin-token',
  'window.sessionStorage',
  'sessionStorage.getItem',
  'sessionStorage.setItem',
  "new CustomEvent('admin-token')",
  'new CustomEvent("admin-token")',
];

const sourceFilePattern = /\.(?:[cm]?[jt]sx?)$/u;

const walkSourceFiles = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkSourceFiles(entryPath);
      }
      return entry.isFile() && sourceFilePattern.test(entry.name) ? [entryPath] : [];
    }),
  );
  return files.flat();
};

test('comment delete paths encode comment identifiers', () => {
  assert.equal(
    buildAdminCommentDeletePath('comment /?%#漢字'),
    '/api/admin/comments/comment%20%2F%3F%25%23%E6%BC%A2%E5%AD%97',
  );
});

test('API errors expose only a JSON error string', async () => {
  assert.equal(
    await readApiError(
      new Response(JSON.stringify({ error: 'コメントを削除できません。' }), {
        headers: { 'content-type': 'application/json' },
      }),
      '削除に失敗しました。',
    ),
    'コメントを削除できません。',
  );
  assert.equal(
    await readApiError(
      new Response('<html><body>internal details</body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
      '削除に失敗しました。',
    ),
    '削除に失敗しました。',
  );
  assert.equal(
    await readApiError(
      new Response(JSON.stringify({ error: 401 }), {
        headers: { 'content-type': 'application/json' },
      }),
      '削除に失敗しました。',
    ),
    '削除に失敗しました。',
  );
});

test('a 401 delete response disables admin mode and explains session expiry', async () => {
  assert.deepEqual(await getAdminCommentDeleteFailure(new Response(null, { status: 401 })), {
    disableAdminMode: true,
    message: ADMIN_SESSION_EXPIRED_MESSAGE,
  });
  assert.match(ADMIN_SESSION_EXPIRED_MESSAGE, /再度有効/u);
});

test('other delete failures keep admin mode and use the safe fallback', async () => {
  assert.deepEqual(
    await getAdminCommentDeleteFailure(
      new Response('<p>unexpected database failure</p>', { status: 500 }),
    ),
    { disableAdminMode: false, message: '削除に失敗しました。' },
  );
});

test('the client uses same-origin cookie authentication and refreshes admin state', async () => {
  const source = await fs.readFile(clientPath, 'utf8');

  assert.match(source, /fetch\(buildAdminCommentDeletePath\(commentId\),/u);
  assert.match(source, /credentials: 'same-origin'/u);
  assert.match(source, /if \(failure\.disableAdminMode\) \{\s*setIsAdminModeEnabled\(false\);/u);
  assert.match(
    source,
    /window\.addEventListener\(ADMIN_SESSION_CHANGED_EVENT, refreshAdminMode\)/u,
  );
  assert.doesNotMatch(source, /response\.text\(\)/u);

  const deleteRequest = source.match(
    /fetch\(buildAdminCommentDeletePath\(commentId\),[\s\S]*?\n\s*\}\);/u,
  )?.[0];
  assert.ok(deleteRequest, 'the comment delete request must be present');
  assert.doesNotMatch(deleteRequest, /headers\s*:/u);
});

test('legacy token UI and token persistence are absent from source and build output', async () => {
  for (const directory of [path.join(projectRoot, 'src'), path.join(projectRoot, 'dist')]) {
    for (const file of await walkSourceFiles(directory)) {
      const content = await fs.readFile(file, 'utf8');
      for (const fragment of forbiddenFragments) {
        assert.ok(
          !content.includes(fragment),
          `Forbidden legacy token fragment ${JSON.stringify(fragment)} in ${path.relative(projectRoot, file)}`,
        );
      }
    }
  }
});

test('the removed admin footer is neither built nor exported', async () => {
  await assert.rejects(() => fs.access(legacySourcePath), { code: 'ENOENT' });
  await assert.rejects(() => fs.access(legacyBuildPath), { code: 'ENOENT' });

  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  assert.ok(!('./submissions/admin-footer-toggle' in packageJson.exports));
});

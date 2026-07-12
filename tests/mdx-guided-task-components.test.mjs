import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(projectRoot, 'src', 'mdx', 'create-use-mdx-components.tsx');

const forbiddenLegacyAnswerName = ['Solu', 'tion'].join('');

test('create-use-mdx-components imports real guided task components from @metyatech/exercise/client', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(
    source,
    /import\s+Exercise\s*,\s*\{\s*Answer\s*,\s*Hint\s*,\s*QuickCheck\s*\}\s+from\s+['"]@metyatech\/exercise\/client['"]/,
    'Must import the default Exercise and named Answer, Hint, QuickCheck from @metyatech/exercise/client',
  );

  // Each guided task component must appear as an exported registration key
  // in the base components map, either as object shorthand (`Key,`) or
  // explicit mapping (`Key: ...`).
  const keys = ['Exercise', 'QuickCheck', 'Hint', 'Answer'];
  for (const key of keys) {
    assert.match(
      source,
      new RegExp(`(?:^|[\\s,{])${key}\\s*(?:,|:)`),
      `Base components map must register ${key}`,
    );
  }

  assert.doesNotMatch(
    source,
    new RegExp(`(?:^|[\\s,{])${forbiddenLegacyAnswerName}\\s*(?:,|:)`),
    'Base components map must not register the legacy answer component',
  );
});

test('create-use-mdx-components does not alias guided task components to one another or to Fragment', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  // Regression guard: previous version aliased QuickCheck -> Exercise,
  // Hint -> Fragment, and Answer -> the legacy answer component. None of those aliases are
  // acceptable in the base components map.
  assert.doesNotMatch(source, /QuickCheck\s*:\s*Exercise\b/, 'QuickCheck must not alias Exercise');
  assert.doesNotMatch(source, /Hint\s*:\s*Fragment\b/, 'Hint must not alias Fragment');
  assert.doesNotMatch(
    source,
    new RegExp(`Answer\\s*:\\s*${forbiddenLegacyAnswerName}\\b`),
    'Answer must not alias the legacy answer component',
  );
  assert.doesNotMatch(
    source,
    /\bFragment\b/,
    'Fragment import is no longer needed and must not be referenced',
  );
});

test('@metyatech/exercise dependency is pinned to the final task-structure SHA', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));

  const expectedSha = '8fedc21361e41cd064a597620772fec1e1b8d965';

  assert.equal(
    packageJson.dependencies['@metyatech/exercise'],
    `github:metyatech/exercise-module#${expectedSha}`,
    'package.json must pin @metyatech/exercise to the final task-structure SHA',
  );

  const lockEntry = lock.packages['node_modules/@metyatech/exercise'];
  assert.ok(lockEntry, 'package-lock.json must include @metyatech/exercise');
  assert.ok(
    lockEntry.resolved?.endsWith(`#${expectedSha}`),
    `package-lock.json resolved URL must end with #${expectedSha}; got ${lockEntry.resolved}`,
  );
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(projectRoot, 'src', 'mdx', 'create-use-mdx-components.tsx');

test('create-use-mdx-components imports real Exercise, QuickCheck, Hint, Answer, Solution from @metyatech/exercise/client', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  assert.match(
    source,
    /import\s+Exercise\s*,\s*\{\s*Answer\s*,\s*Hint\s*,\s*QuickCheck\s*,\s*Solution\s*\}\s+from\s+['"]@metyatech\/exercise\/client['"]/,
    'Must import the default Exercise and named Answer, Hint, QuickCheck, Solution from @metyatech/exercise/client',
  );

  // Each guided task component must appear as an exported registration key
  // in the base components map, either as object shorthand (`Key,`) or
  // explicit mapping (`Key: ...`).
  const keys = ['Exercise', 'QuickCheck', 'Hint', 'Answer', 'Solution'];
  for (const key of keys) {
    assert.match(
      source,
      new RegExp(`(?:^|[\\s,{])${key}\\s*(?:,|:)`),
      `Base components map must register ${key}`,
    );
  }
});

test('create-use-mdx-components does not alias guided task components to one another or to Fragment', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');

  // Regression guard: previous version aliased QuickCheck -> Exercise,
  // Hint -> Fragment, and Answer -> Solution. None of those aliases are
  // acceptable in the base components map.
  assert.doesNotMatch(source, /QuickCheck\s*:\s*Exercise\b/, 'QuickCheck must not alias Exercise');
  assert.doesNotMatch(source, /Hint\s*:\s*Fragment\b/, 'Hint must not alias Fragment');
  assert.doesNotMatch(source, /Answer\s*:\s*Solution\b/, 'Answer must not alias Solution');
  assert.doesNotMatch(
    source,
    /\bFragment\b/,
    'Fragment import is no longer needed and must not be referenced',
  );
});

test('@metyatech/exercise dependency is pinned to the platform-compat SHA', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));

  const expectedSha = 'd27ed7d2c47018ac0f7df205568bc502fc6c3eb3';

  assert.equal(
    packageJson.dependencies['@metyatech/exercise'],
    `github:metyatech/exercise-module#${expectedSha}`,
    'package.json must pin @metyatech/exercise to the platform-compat SHA',
  );

  const lockEntry = lock.packages['node_modules/@metyatech/exercise'];
  assert.ok(lockEntry, 'package-lock.json must include @metyatech/exercise');
  assert.ok(
    lockEntry.resolved?.endsWith(`#${expectedSha}`),
    `package-lock.json resolved URL must end with #${expectedSha}; got ${lockEntry.resolved}`,
  );
});

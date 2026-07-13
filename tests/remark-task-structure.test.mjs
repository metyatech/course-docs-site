import assert from 'node:assert/strict';
import test from 'node:test';

const pluginModulePath = '../dist/mdx/remark-task-structure.js';

const createVFileStub = (path = 'content/docs/tasks.mdx') => ({
  path,
  fail(reason) {
    const err = new Error(reason);
    err.reason = reason;
    throw err;
  },
});

const jsxElement = (name, ...children) => ({
  type: 'mdxJsxFlowElement',
  name,
  attributes: [],
  children,
});

const paragraph = (text) => ({
  type: 'paragraph',
  children: [{ type: 'text', value: text }],
});

const root = (...children) => ({ type: 'root', children });

const mdxComment = () => ({ type: 'mdxFlowExpression', value: '/* author note */' });
const emptyExpression = () => ({ type: 'mdxFlowExpression', value: '   ' });
const emptyFragment = () => jsxElement('Fragment', { type: 'text', value: '   ' });
const forbiddenLegacyAnswerName = ['Solu', 'tion'].join('');

const run = async (tree) => {
  const { default: plugin } = await import(pluginModulePath);
  plugin()(tree, createVFileStub());
};

const assertStructureError = async (tree, pattern) => {
  const { default: plugin } = await import(pluginModulePath);
  assert.throws(
    () => plugin()(tree, createVFileStub()),
    (error) => {
      const message = String(error.reason ?? error.message ?? '');
      assert.match(message, /content\/docs\/tasks\.mdx/);
      assert.match(message, /Actual order:/);
      assert.match(message, /Expected order:/);
      assert.match(message, /Fix:/);
      assert.match(message, pattern);
      return true;
    },
  );
};

test('valid QuickCheck with problem, Hint, and Answer passes', async () => {
  await assert.doesNotReject(() =>
    run(
      root(
        jsxElement(
          'QuickCheck',
          paragraph('問題です'),
          jsxElement('Hint', paragraph('ヒント')),
          jsxElement('Answer', paragraph('答え')),
        ),
      ),
    ),
  );
});

test('valid Exercise with problem, Hint, and Answer passes', async () => {
  await assert.doesNotReject(() =>
    run(
      root(
        jsxElement(
          'Exercise',
          paragraph('問題です'),
          jsxElement('Hint', paragraph('ヒント')),
          jsxElement('Answer', paragraph('答え')),
        ),
      ),
    ),
  );
});

test('multiple hints are allowed before Answer', async () => {
  await assert.doesNotReject(() =>
    run(
      root(
        jsxElement(
          'QuickCheck',
          paragraph('問題です'),
          jsxElement('Hint', paragraph('ヒント 1')),
          jsxElement('Hint', paragraph('ヒント 2')),
          jsxElement('Answer', paragraph('答え')),
        ),
      ),
    ),
  );
});

test('missing Hint fails for QuickCheck and Exercise', async () => {
  await assertStructureError(
    root(jsxElement('QuickCheck', paragraph('問題です'), jsxElement('Answer', paragraph('答え')))),
    /at least one <Hint> is required/,
  );
  await assertStructureError(
    root(jsxElement('Exercise', paragraph('問題です'), jsxElement('Answer', paragraph('答え')))),
    /at least one <Hint> is required/,
  );
});

test('missing problem content fails', async () => {
  await assertStructureError(
    root(jsxElement('QuickCheck', jsxElement('Answer', paragraph('答え')))),
    /problem content is missing/,
  );
});

test('missing Answer fails for QuickCheck', async () => {
  await assertStructureError(
    root(jsxElement('QuickCheck', paragraph('問題です'))),
    /<Answer> is missing/,
  );
});

test('missing Answer fails for Exercise', async () => {
  await assertStructureError(
    root(jsxElement('Exercise', paragraph('問題です'))),
    /<Answer> is missing/,
  );
});

test('multiple answers fail', async () => {
  await assertStructureError(
    root(
      jsxElement(
        'QuickCheck',
        paragraph('問題です'),
        jsxElement('Hint', paragraph('ヒント')),
        jsxElement('Answer', paragraph('答え 1')),
        jsxElement('Answer', paragraph('答え 2')),
      ),
    ),
    /expected exactly one <Answer>/,
  );
});

test('Answer in the middle fails', async () => {
  await assertStructureError(
    root(
      jsxElement(
        'QuickCheck',
        paragraph('問題です'),
        jsxElement('Hint', paragraph('ヒント')),
        jsxElement('Answer', paragraph('答え')),
        jsxElement('Hint', paragraph('遅いヒント')),
      ),
    ),
    /<Hint> appears after <Answer>/,
  );
});

test('content after Answer fails', async () => {
  await assertStructureError(
    root(
      jsxElement(
        'QuickCheck',
        paragraph('問題です'),
        jsxElement('Hint', paragraph('ヒント')),
        jsxElement('Answer', paragraph('答え')),
        paragraph('補足を後ろに置いてしまった'),
      ),
    ),
    /content appears after <Answer>/,
  );
});

test('external Hint and Answer fail outside task blocks', async () => {
  await assertStructureError(root(jsxElement('Hint', paragraph('外部ヒント'))), /direct child/);
  await assertStructureError(root(jsxElement('Answer', paragraph('外部答え'))), /direct child/);
});

test('indirect Hint and Answer fail inside task blocks', async () => {
  await assertStructureError(
    root(
      jsxElement(
        'QuickCheck',
        paragraph('問題です'),
        jsxElement('Hint', paragraph('ヒント')),
        jsxElement('div', jsxElement('Hint', paragraph('間接ヒント'))),
        jsxElement('Answer', paragraph('答え')),
      ),
    ),
    /problem content appears after <Hint>|direct child/,
  );
  await assertStructureError(
    root(
      jsxElement(
        'QuickCheck',
        paragraph('問題です'),
        jsxElement('Hint', paragraph('ヒント')),
        jsxElement('div', jsxElement('Answer', paragraph('間接答え'))),
      ),
    ),
    /<Answer> is missing|direct child/,
  );
});

test('nested task fails', async () => {
  await assertStructureError(
    root(
      jsxElement(
        'Exercise',
        paragraph('問題です'),
        jsxElement('Hint', paragraph('ヒント')),
        jsxElement('QuickCheck', paragraph('小問'), jsxElement('Answer', paragraph('答え'))),
        jsxElement('Answer', paragraph('答え')),
      ),
    ),
    /nested <QuickCheck>/,
  );
});

test('MDX comments, empty expressions, whitespace, and empty Fragment are ignored', async () => {
  await assert.doesNotReject(() =>
    run(
      root(
        jsxElement(
          'QuickCheck',
          { type: 'text', value: '   ' },
          mdxComment(),
          emptyExpression(),
          emptyFragment(),
          paragraph('問題です'),
          jsxElement('Hint', paragraph('ヒント')),
          jsxElement('Answer', mdxComment(), paragraph('答え')),
        ),
      ),
    ),
  );
});

test('legacy answer component inside Exercise fails even when direct and last', async () => {
  await assertStructureError(
    root(
      jsxElement(
        'Exercise',
        paragraph('問題です'),
        jsxElement(forbiddenLegacyAnswerName, paragraph('旧答え')),
      ),
    ),
    new RegExp(`<${forbiddenLegacyAnswerName}> is no longer supported`),
  );
});

test('legacy answer component inside QuickCheck fails', async () => {
  await assertStructureError(
    root(
      jsxElement(
        'QuickCheck',
        paragraph('問題です'),
        jsxElement(forbiddenLegacyAnswerName, paragraph('旧答え')),
      ),
    ),
    new RegExp(`<${forbiddenLegacyAnswerName}> is no longer supported`),
  );
});

test('legacy answer component outside task blocks fails', async () => {
  await assertStructureError(
    root(jsxElement(forbiddenLegacyAnswerName, paragraph('外部の旧答え'))),
    new RegExp(`<${forbiddenLegacyAnswerName}> is no longer supported`),
  );
});

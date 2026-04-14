import assert from 'node:assert/strict';
import test from 'node:test';

const pluginModulePath = '../dist/mdx/tutorial/remark-tutorial-lint.js';

const createVFileStub = (path = 'test.mdx') => {
  const warnings = [];
  return {
    file: {
      path,
      fail(reason) {
        const err = new Error(reason);
        err.reason = reason;
        throw err;
      },
      message(reason, place, origin) {
        warnings.push({ reason, origin });
      },
    },
    warnings,
  };
};

const section = (attrs, ...children) => ({
  type: 'mdxJsxFlowElement',
  name: 'Section',
  attributes: Object.entries(attrs).map(([name, value]) => ({
    type: 'mdxJsxAttribute',
    name,
    value,
  })),
  children,
});

const action = (attrs, ...children) => ({
  type: 'mdxJsxFlowElement',
  name: 'Action',
  attributes: Object.entries(attrs).map(([name, value]) => ({
    type: 'mdxJsxAttribute',
    name,
    value,
  })),
  children,
});

const jsxElement = (name, attrs = {}, ...children) => ({
  type: 'mdxJsxFlowElement',
  name,
  attributes: Object.entries(attrs).map(([attrName, value]) => ({
    type: 'mdxJsxAttribute',
    name: attrName,
    value,
  })),
  children,
});

const paragraph = (text) => ({
  type: 'paragraph',
  children: [{ type: 'text', value: text }],
});

const mdImage = (url = './img.png') => ({
  type: 'image',
  url,
  alt: '',
});

const root = (...children) => ({
  type: 'root',
  children,
});

// Suppress console.warn spam from the plugin during tests.
const originalConsoleWarn = console.warn;
test.before(() => {
  console.warn = () => {};
});
test.after(() => {
  console.warn = originalConsoleWarn;
});

test('<Section> without goal prop fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(section({}, paragraph('body')));
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /section-goal-required/);
});

test('<Section> with past-tense goal fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(section({ goal: 'キューブが置かれた状態' }, paragraph('body')));
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /section-goal-tense/);
});

test('<Section> with future goal passes', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section({ goal: 'キューブを 1 つ置きます' }, jsxElement('Checkpoint', {}, paragraph('done'))),
  );
  const { file } = createVFileStub();
  assert.doesNotThrow(() => plugin()(tree, file));
});

test('<Action> with two images fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('text'), mdImage('./b.png')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /action-single-image/);
});

test('<Action> with positional prefix emits a warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('左側から「新規プロジェクト」を押します')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => w.origin?.includes('action-positional-prefix')),
    'expected action-positional-prefix warning',
  );
});

test('<Section> containing --- horizontal rule fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      { type: 'thematicBreak' },
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /section-no-hrule/);
});

test('image-only <Reference> emits a warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      jsxElement('Reference', { title: 'ここまでの状態' }, mdImage()),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => w.origin?.includes('reference-image-only')),
    'expected reference-image-only warning',
  );
});

test('<Verify> starting with → emits a duplicate-arrow warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      jsxElement('Verify', {}, paragraph('→ 成功です')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => w.origin?.includes('verify-no-duplicate-arrow')),
    'expected verify-no-duplicate-arrow warning',
  );
});

test('<Verify> without leading → does not warn', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      jsxElement('Verify', {}, paragraph('成功です')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    !warnings.some((w) => w.origin?.includes('verify-no-duplicate-arrow')),
    'Verify without leading → should not warn',
  );
});

test('multiple <Checkpoint> in one Step fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      jsxElement('Checkpoint', {}, paragraph('a')),
      jsxElement('Checkpoint', {}, paragraph('b')),
    ),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /checkpoint-placement/);
});

test('content after <Checkpoint> fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      jsxElement('Checkpoint', {}, paragraph('a')),
      paragraph('this should not be here'),
    ),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /checkpoint-placement/);
});

test('Checkpoint nested inside subsection fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'outer' },
      section({ goal: 'inner' }, jsxElement('Checkpoint', {}, paragraph('a'))),
    ),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /checkpoint-placement/);
});

test('well-formed Step with exercise before Checkpoint passes', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      section(
        { goal: 'N-1 します' },
        action({ img: './a.png' }, paragraph('「**作成**」をクリックします')),
        jsxElement('Verify', {}, paragraph('成功です')),
      ),
      section({ goal: '演習 goal' }, jsxElement('Exercise', {}, paragraph('body'))),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  assert.doesNotThrow(() => plugin()(tree, file));
  assert.deepEqual(warnings, []);
});

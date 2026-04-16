import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import process from 'node:process';

const pluginModulePath = '../dist/mdx/tutorial/remark-tutorial-lint.js';

// Captured console.info lines (notes) across tests. Tests execute
// sequentially (node:test is single-threaded here) so a slice view
// per-stub is safe.
const capturedInfo = [];

const createVFileStub = (path = 'test.mdx') => {
  const warnings = [];
  const startIndex = capturedInfo.length;
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
    get notes() {
      return capturedInfo.slice(startIndex);
    },
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

const yamlFrontmatter = (value) => ({
  type: 'yaml',
  value,
});

const mdxEsm = (value) => ({
  type: 'mdxjsEsm',
  value,
});

const tutorialRoot = (...children) =>
  root(yamlFrontmatter('title: Tutorial\nauthoringMode: tutorial'), ...children);

// Suppress console.warn spam and capture console.info lines (notes).
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
test.before(() => {
  console.warn = () => {};
  console.info = (...args) => {
    capturedInfo.push(String(args[0] ?? ''));
  };
});
test.after(() => {
  console.warn = originalConsoleWarn;
  console.info = originalConsoleInfo;
});

test('<Section> without goal prop fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(section({}, paragraph('body')));
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /section-goal-required/);
});

test('<Section> with past-tense goal emits a note (advisory only)', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'キューブが置かれた状態' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  assert.doesNotThrow(() => plugin()(tree, stub.file));
  assert.ok(
    stub.notes.some((n) => /section-goal-tense/.test(n)),
    'section-goal-tense should be a note, not an error',
  );
});

test('<Section> with future goal passes', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section({ goal: 'キューブを 1 つ置きます' }, jsxElement('Checkpoint', {}, paragraph('done'))),
  );
  const { file } = createVFileStub();
  assert.doesNotThrow(() => plugin()(tree, file));
});

test('<Action> with two images fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
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
  const tree = tutorialRoot(
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

test('<Section> containing --- horizontal rule emits a warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      { type: 'thematicBreak' },
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => w.origin?.includes('section-no-hrule')),
    'expected section-no-hrule warning',
  );
});

test('image-only <Reference> emits a note (advisory)', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      jsxElement('Reference', { title: 'ここまでの状態' }, mdImage()),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /reference-image-only/.test(n)),
    'reference-image-only should be a note, not a warning',
  );
});

test('<Verify> starting with → emits a duplicate-arrow warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
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
  const tree = tutorialRoot(
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

test('multiple <Checkpoint> in one Step emits a warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      jsxElement('Checkpoint', {}, paragraph('a')),
      jsxElement('Checkpoint', {}, paragraph('b')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => w.origin?.includes('checkpoint-placement')),
    'expected checkpoint-placement warning',
  );
});

test('content after <Checkpoint> emits a warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      jsxElement('Checkpoint', {}, paragraph('a')),
      paragraph('this should not be here'),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => w.origin?.includes('checkpoint-placement')),
    'expected checkpoint-placement warning',
  );
});

test('Checkpoint nested inside subsection emits a warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'outer' },
      section({ goal: 'inner' }, jsxElement('Checkpoint', {}, paragraph('a'))),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => w.origin?.includes('checkpoint-placement')),
    'expected checkpoint-placement warning',
  );
});

test('well-formed Step with exercise before Checkpoint passes', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
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

// -----------------------------------------------------------------------
// Principle-driven rules (Mayer / CLT)
// -----------------------------------------------------------------------

const strong = (text) => ({
  type: 'strong',
  children: [{ type: 'text', value: text }],
});

const paragraphWithChildren = (...children) => ({ type: 'paragraph', children });

test('Action with six bold spans emits action-bold-overuse note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action(
        { img: './a.png' },
        paragraphWithChildren(
          strong('A'),
          { type: 'text', value: ' ' },
          strong('B'),
          { type: 'text', value: ' ' },
          strong('C'),
          { type: 'text', value: ' ' },
          strong('D'),
          { type: 'text', value: ' ' },
          strong('E'),
          { type: 'text', value: ' ' },
          strong('F'),
          { type: 'text', value: ' を選びます' },
        ),
      ),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /action-bold-overuse/.test(n)),
    'action-bold-overuse should be a note on 6+ bold spans',
  );
  assert.ok(
    !stub.warnings.some((w) => /action-bold-overuse/.test(w.origin ?? '')),
    'action-bold-overuse must not be a warning',
  );
});

test('Action with five bold spans does not emit action-bold-overuse', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action(
        { img: './a.png' },
        paragraphWithChildren(
          strong('A'),
          { type: 'text', value: ' ' },
          strong('B'),
          { type: 'text', value: ' ' },
          strong('C'),
          { type: 'text', value: ' ' },
          strong('D'),
          { type: 'text', value: ' ' },
          strong('E'),
        ),
      ),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.notes.some((n) => /action-bold-overuse/.test(n)),
    'five bold spans should not emit action-bold-overuse',
  );
});

test('third-person reader ("受講者") emits Personalization note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    paragraph('受講者が操作を行います'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /third-person-reader/.test(n)),
    'third-person-reader should be a note',
  );
});

test('second-person addressing does not trigger third-person note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    paragraph('ここで Unreal Engine を起動しましょう'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.notes.some((n) => /third-person-reader/.test(n)),
    'second-person should not emit third-person-reader note',
  );
});

test('page opening with "この教材は" emits Personalization note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    paragraph('この教材は Unreal Engine の入門資料です'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /page-opens-with-doc-description/.test(n)),
    'page-opens-with-doc-description should be a note',
  );
});

test('Verify describing internal mechanics emits a note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('Destroy Actor が実行されました')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /verify-internal-mechanics/.test(n)),
    'verify-internal-mechanics should be a note',
  );
});

test('Concept with 11 sentences emits concept-length note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      jsxElement(
        'Concept',
        { title: 'コリジョン' },
        paragraph(
          '文1です。文2です。文3です。文4です。文5です。文6です。文7です。文8です。文9です。文10です。文11です。',
        ),
      ),
      action({ img: './a.png' }, paragraph('コリジョンを設定します')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /concept-length/.test(n)),
    'concept-length should be a note beyond advisory threshold',
  );
});

test('Concept with no following usage site emits concept-placement note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Concept', { title: '終わったあとの用語' }, paragraph('短い説明')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /concept-placement/.test(n)),
    'concept-placement should be a note when no usage site follows',
  );
});

test('Concept immediately before Action does not emit concept-placement', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      jsxElement('Concept', { title: '用語' }, paragraph('短い説明')),
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.notes.some((n) => /concept-placement/.test(n)),
    'concept placed before a usage site should not emit concept-placement',
  );
});

test('Section with Action but no feedback surface emits section-lacks-feedback', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section({ goal: 'foo します' }, action({ img: './a.png' }, paragraph('進めます'))),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /section-lacks-feedback/.test(w.origin ?? '')),
    'section-lacks-feedback should warn',
  );
});

test('Section that delegates to nested Sections is exempt from feedback rule', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'outer goal します' },
      section(
        { goal: 'inner goal します' },
        action({ img: './a.png' }, paragraph('進めます')),
        jsxElement('Verify', {}, paragraph('成功')),
      ),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    !warnings.some((w) => /section-lacks-feedback/.test(w.origin ?? '')),
    'grouping Section should not warn',
  );
});

test('decorative emoji outside signaling surface emits a note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    paragraph('楽しく進めましょう 🎉'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /decorative-emoji/.test(n)),
    'decorative-emoji should be a note',
  );
});

test('signalling emoji (✅) inside Checkpoint is allowed', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('✅ done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.notes.some((n) => /decorative-emoji/.test(n)) &&
      !stub.warnings.some((w) => /decorative-emoji/.test(w.origin ?? '')),
    '✅ inside Checkpoint should not emit decorative-emoji',
  );
});

test('TUTORIAL_LINT_STRICT=1 promotes warnings into build-failing errors', async () => {
  const { default: plugin } = await import(pluginModulePath);
  // Use a warn-level violation (section-no-hrule) because notes are
  // never promoted to errors, only warnings are.
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      { type: 'thematicBreak' },
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file } = createVFileStub();
  const prev = process.env.TUTORIAL_LINT_STRICT;
  process.env.TUTORIAL_LINT_STRICT = '1';
  try {
    assert.throws(() => plugin()(tree, file), /section-no-hrule.*\[strict\]/);
  } finally {
    if (prev === undefined) delete process.env.TUTORIAL_LINT_STRICT;
    else process.env.TUTORIAL_LINT_STRICT = prev;
  }
});

test('TUTORIAL_LINT_STRICT does NOT promote notes to errors', async () => {
  const { default: plugin } = await import(pluginModulePath);
  // decorative-emoji is a note, so strict mode must leave it as a note.
  const tree = tutorialRoot(
    paragraph('楽しく進めましょう 🎉'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  const prev = process.env.TUTORIAL_LINT_STRICT;
  process.env.TUTORIAL_LINT_STRICT = '1';
  try {
    assert.doesNotThrow(() => plugin()(tree, stub.file));
    assert.ok(
      stub.notes.some((n) => /decorative-emoji/.test(n)),
      'note should still appear even under strict',
    );
  } finally {
    if (prev === undefined) delete process.env.TUTORIAL_LINT_STRICT;
    else process.env.TUTORIAL_LINT_STRICT = prev;
  }
});

test('TUTORIAL_LINT_STRICT unset leaves warnings as warnings', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      { type: 'thematicBreak' },
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  const prev = process.env.TUTORIAL_LINT_STRICT;
  delete process.env.TUTORIAL_LINT_STRICT;
  try {
    assert.doesNotThrow(() => plugin()(tree, file));
    assert.ok(warnings.some((w) => /section-no-hrule/.test(w.origin ?? '')));
  } finally {
    if (prev !== undefined) process.env.TUTORIAL_LINT_STRICT = prev;
  }
});

test('TUTORIAL_LINT_COLLECT=1 fails once when warnings + notes are mixed', async () => {
  const { default: plugin } = await import(pluginModulePath);
  // Mix a warning (section-no-hrule) with notes so collect-all has to
  // aggregate and fail once (because a warning is present).
  const tree = tutorialRoot(
    paragraph('この教材は Unreal Engine の入門資料です'), // note
    paragraph('受講者が操作を行います'), // note
    paragraph('楽しく 🎉'), // note
    section(
      { goal: 'foo します' },
      { type: 'thematicBreak' }, // warn: section-no-hrule
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file } = createVFileStub();
  const prevCollect = process.env.TUTORIAL_LINT_COLLECT;
  const prevStrict = process.env.TUTORIAL_LINT_STRICT;
  process.env.TUTORIAL_LINT_COLLECT = '1';
  delete process.env.TUTORIAL_LINT_STRICT;
  try {
    let thrown;
    try {
      plugin()(tree, file);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, 'collect-all must fail once when at least one warn/error is present');
    const body = String(thrown.reason ?? thrown.message ?? '');
    assert.match(body, /tutorial-lint.*issue\(s\).*\[collect-all\]/);
    // Warn and all note rules should be present in the summary.
    assert.match(body, /section-no-hrule/);
    assert.match(body, /page-opens-with-doc-description/);
    assert.match(body, /third-person-reader/);
    assert.match(body, /decorative-emoji/);
  } finally {
    if (prevCollect === undefined) delete process.env.TUTORIAL_LINT_COLLECT;
    else process.env.TUTORIAL_LINT_COLLECT = prevCollect;
    if (prevStrict !== undefined) process.env.TUTORIAL_LINT_STRICT = prevStrict;
  }
});

test('TUTORIAL_LINT_COLLECT=1 does NOT fail when only notes are found', async () => {
  const { default: plugin } = await import(pluginModulePath);
  // Notes-only tree: all the below rules are notes.
  const tree = tutorialRoot(
    paragraph('この教材は 〜 です'), // note: page-opens-with-doc-description
    paragraph('受講者が 〜'), // note: third-person-reader
    paragraph('🎉'), // note: decorative-emoji
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  const prevCollect = process.env.TUTORIAL_LINT_COLLECT;
  process.env.TUTORIAL_LINT_COLLECT = '1';
  try {
    assert.doesNotThrow(() => plugin()(tree, stub.file), 'notes-only should not fail collect-all');
    // The aggregated summary is printed via console.info.
    assert.ok(
      stub.notes.some((n) => /\[collect-all\]/.test(n)),
      'collect-all summary should still be printed',
    );
  } finally {
    if (prevCollect === undefined) delete process.env.TUTORIAL_LINT_COLLECT;
    else process.env.TUTORIAL_LINT_COLLECT = prevCollect;
  }
});

test('TUTORIAL_LINT_COLLECT=1 passes clean documents without throwing', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    paragraph('ここで Unreal Engine を起動しましょう'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  const prev = process.env.TUTORIAL_LINT_COLLECT;
  process.env.TUTORIAL_LINT_COLLECT = '1';
  try {
    assert.doesNotThrow(() => plugin()(tree, file));
    assert.deepEqual(warnings, []);
  } finally {
    if (prev === undefined) delete process.env.TUTORIAL_LINT_COLLECT;
    else process.env.TUTORIAL_LINT_COLLECT = prev;
  }
});

test('authoringMode: tutorial without <Section> fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    yamlFrontmatter('title: Tutorial\nauthoringMode: tutorial'),
    paragraph('ここから始めましょう'),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /page-mode-tutorial-requires-section/);
});

test('authoringMode: non-tutorial with <Section> fails', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    yamlFrontmatter('title: Memo\nauthoringMode: non-tutorial'),
    section({ goal: 'foo します' }, jsxElement('Checkpoint', {}, paragraph('done'))),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /page-mode-non-tutorial-has-section/);
});

test('invalid authoringMode value fails fast', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(yamlFrontmatter('title: Broken\nauthoringMode: hybrid'), paragraph('invalid'));
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /page-authoring-mode-invalid/);
});

test('pages with <Section> but no authoringMode fail because default mode is non-tutorial', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file } = createVFileStub();
  assert.throws(() => plugin()(tree, file), /page-mode-non-tutorial-has-section/);
});

test('mdx metadata export can declare tutorial mode explicitly', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    mdxEsm("export const metadata = { title: 'Tutorial', authoringMode: 'tutorial' }"),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  assert.doesNotThrow(() => plugin()(tree, stub.file));
  assert.deepEqual(stub.warnings, []);
});

test('pages without <Section> are treated as non-tutorials and skipped', async () => {
  const { default: plugin } = await import(pluginModulePath);
  // A teacher-facing memo that would violate Personalization
  // (page-opens-with-doc-description) and decorative-emoji, but carries
  // no <Section>, so the plugin must not flag it.
  const tree = root(
    paragraph('このページは、授業を止めないための運営メモです 🎉'),
    paragraph('受講者は事前に確認してください'),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.deepEqual(warnings, [], 'non-tutorial pages must not emit any tutorial-lint findings');
});

test('pages without <Section> skip even in strict/collect modes', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(paragraph('このページは運営メモです 🎉'), paragraph('学習者は〜'));
  const { file } = createVFileStub();
  const prevStrict = process.env.TUTORIAL_LINT_STRICT;
  const prevCollect = process.env.TUTORIAL_LINT_COLLECT;
  process.env.TUTORIAL_LINT_STRICT = '1';
  process.env.TUTORIAL_LINT_COLLECT = '1';
  try {
    assert.doesNotThrow(() => plugin()(tree, file));
  } finally {
    if (prevStrict === undefined) delete process.env.TUTORIAL_LINT_STRICT;
    else process.env.TUTORIAL_LINT_STRICT = prevStrict;
    if (prevCollect === undefined) delete process.env.TUTORIAL_LINT_COLLECT;
    else process.env.TUTORIAL_LINT_COLLECT = prevCollect;
  }
});

test('<Action img> with result-check language emits verify-visual-workaround-as-action note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      // img + "〜ていることを確認" phrasing = verify workaround
      action(
        { img: './img/result.png' },
        paragraph('コンパイルアイコンが緑のチェックになっていることを確認します'),
      ),
      jsxElement('Verify', {}, paragraph('成功です')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /verify-visual-workaround-as-action/.test(n)),
    'expected verify-visual-workaround-as-action note',
  );
});

test('<Action> without img with confirm language does not emit verify-visual-workaround-as-action', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      // No img prop — text-only Actions can legitimately say "confirm"
      action({}, paragraph('グラフの形になっていることを確認します')),
      jsxElement('Verify', {}, paragraph('成功です')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.notes.some((n) => /verify-visual-workaround-as-action/.test(n)),
    '<Action> without img should not emit verify-visual-workaround-as-action',
  );
});

// --- Prerequisites placement ------------------------------------------------

test('<Prerequisites> after first <Section> emits a warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action({}, paragraph('click')),
      jsxElement('Verify', {}, paragraph('ok')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
    // Prerequisites placed AFTER Section — wrong placement
    jsxElement('Prerequisites', {}, paragraph('Node.js 20 以上')),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.warnings.some((w) => w.origin?.includes('prerequisites-placement')),
    'expected prerequisites-placement warning when Prerequisites follows Section',
  );
});

test('<Prerequisites> before first <Section> does not warn', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    // Prerequisites placed BEFORE Section — correct placement
    jsxElement('Prerequisites', {}, paragraph('Node.js 20 以上')),
    section(
      { goal: 'foo します' },
      action({}, paragraph('click')),
      jsxElement('Verify', {}, paragraph('ok')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.warnings.some((w) => w.origin?.includes('prerequisites-placement')),
    '<Prerequisites> before Section should not warn',
  );
});

test('tutorial without <Prerequisites> does not warn', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action({}, paragraph('click')),
      jsxElement('Verify', {}, paragraph('ok')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.warnings.some((w) => w.origin?.includes('prerequisites-placement')),
    'absent Prerequisites should not trigger a warning',
  );
});

// --- NextSteps placement ----------------------------------------------------

test('<NextSteps> before last <Section> emits a note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'step1 します' },
      action({}, paragraph('click')),
      jsxElement('Verify', {}, paragraph('ok')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
    // NextSteps placed BEFORE last Section — wrong placement
    jsxElement('NextSteps', {}, paragraph('次のチュートリアルへ')),
    section(
      { goal: 'step2 します' },
      action({}, paragraph('click')),
      jsxElement('Verify', {}, paragraph('ok')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    stub.notes.some((n) => /nextsteps-placement/.test(n)),
    'expected nextsteps-placement note when NextSteps precedes last Section',
  );
});

test('<NextSteps> after last <Section> does not emit a note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action({}, paragraph('click')),
      jsxElement('Verify', {}, paragraph('ok')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
    // NextSteps placed AFTER last Section — correct placement
    jsxElement('NextSteps', {}, paragraph('次のチュートリアルへ')),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.notes.some((n) => /nextsteps-placement/.test(n)),
    '<NextSteps> after last Section should not emit note',
  );
});

test('tutorial without <NextSteps> does not emit a note', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = tutorialRoot(
    section(
      { goal: 'foo します' },
      action({}, paragraph('click')),
      jsxElement('Verify', {}, paragraph('ok')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const stub = createVFileStub();
  plugin()(tree, stub.file);
  assert.ok(
    !stub.notes.some((n) => /nextsteps-placement/.test(n)),
    'absent NextSteps should not trigger a note',
  );
});

// ── verify-shot-action-role ──────────────────────────────────────────────────

test('<Verify img="..."> with role="action" annotation in .shot.json fails build', async () => {
  const { default: plugin } = await import(pluginModulePath);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutorial-lint-verify-action-'));
  const imgDir = path.join(tempDir, 'img');
  const shotsDir = path.join(tempDir, 'shots');
  await fs.mkdir(imgDir, { recursive: true });
  await fs.mkdir(shotsDir, { recursive: true });

  const manifest = {
    version: 1,
    id: 'result',
    pagePath: 'content/docs/tutorial/index.mdx',
    outputImagePath: 'content/docs/tutorial/img/result.png',
    rawImagePath: 'content/docs/tutorial/shots/result.raw.png',
    crop: null,
    annotations: [{ id: 'a1', type: 'box', role: 'action', x: 0, y: 0, width: 100, height: 50 }],
    annotationMode: 'focal',
    alt: '',
  };
  await fs.writeFile(
    path.join(shotsDir, 'result.shot.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  const mdxFilePath = path.join(tempDir, 'index.mdx');
  const tree = tutorialRoot(
    section(
      { goal: 'done' },
      jsxElement('Verify', { img: './img/result.png' }, paragraph('画面がこの状態になれば成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );

  const { file } = createVFileStub(mdxFilePath);
  assert.throws(
    () => plugin()(tree, file),
    (err) => {
      assert.ok(
        /verify-shot-action-role/.test(err.message),
        `Expected verify-shot-action-role in error, got: ${err.message}`,
      );
      return true;
    },
    'Should throw with verify-shot-action-role when Verify shot has action annotation',
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('<Verify img="..."> with only role="verify" annotations passes lint', async () => {
  const { default: plugin } = await import(pluginModulePath);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutorial-lint-verify-ok-'));
  const imgDir = path.join(tempDir, 'img');
  const shotsDir = path.join(tempDir, 'shots');
  await fs.mkdir(imgDir, { recursive: true });
  await fs.mkdir(shotsDir, { recursive: true });

  const manifest = {
    version: 1,
    id: 'result',
    pagePath: 'content/docs/tutorial/index.mdx',
    outputImagePath: 'content/docs/tutorial/img/result.png',
    rawImagePath: 'content/docs/tutorial/shots/result.raw.png',
    crop: null,
    annotations: [{ id: 'v1', type: 'box', role: 'verify', x: 0, y: 0, width: 100, height: 50 }],
    annotationMode: 'focal',
    alt: '',
  };
  await fs.writeFile(
    path.join(shotsDir, 'result.shot.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  const mdxFilePath = path.join(tempDir, 'index.mdx');
  const tree = tutorialRoot(
    section(
      { goal: 'done' },
      jsxElement('Verify', { img: './img/result.png' }, paragraph('画面がこの状態になれば成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );

  const { file } = createVFileStub(mdxFilePath);
  assert.doesNotThrow(
    () => plugin()(tree, file),
    'Should not throw when Verify shot has only verify-role annotations',
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('<Verify img="..."> with no .shot.json file is silently skipped', async () => {
  const { default: plugin } = await import(pluginModulePath);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutorial-lint-verify-noshot-'));
  const mdxFilePath = path.join(tempDir, 'index.mdx');

  const tree = tutorialRoot(
    section(
      { goal: 'done' },
      jsxElement('Verify', { img: './img/result.png' }, paragraph('画面がこの状態になれば成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );

  const { file } = createVFileStub(mdxFilePath);
  assert.doesNotThrow(
    () => plugin()(tree, file),
    'Should not throw when .shot.json does not exist yet',
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('<Verify> without img attr is not affected by verify-shot-action-role', async () => {
  const { default: plugin } = await import(pluginModulePath);

  const tree = tutorialRoot(
    section(
      { goal: 'done' },
      jsxElement('Verify', {}, paragraph('画面がこの状態になれば成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );

  const { file } = createVFileStub('test.mdx');
  assert.doesNotThrow(
    () => plugin()(tree, file),
    'Verify without img should not trigger verify-shot-action-role',
  );
});

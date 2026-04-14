import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';

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

// -----------------------------------------------------------------------
// Principle-driven rules (Mayer / CLT)
// -----------------------------------------------------------------------

const strong = (text) => ({
  type: 'strong',
  children: [{ type: 'text', value: text }],
});

const paragraphWithChildren = (...children) => ({ type: 'paragraph', children });

test('Action with four bold spans emits action-bold-overuse warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
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
          { type: 'text', value: ' を選びます' },
        ),
      ),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /action-bold-overuse/.test(w.origin ?? '')),
    'action-bold-overuse should warn on 4+ bold spans',
  );
});

test('Action with three bold spans does not warn (small signaling table is allowed)', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
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
        ),
      ),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    !warnings.some((w) => /action-bold-overuse/.test(w.origin ?? '')),
    'three bold spans should not warn (typical key-row table)',
  );
});

test('third-person reader ("受講者") emits Personalization warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    paragraph('受講者が操作を行います'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /third-person-reader/.test(w.origin ?? '')),
    'third-person-reader should warn',
  );
});

test('second-person addressing does not trigger third-person warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    paragraph('ここで Unreal Engine を起動しましょう'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    !warnings.some((w) => /third-person-reader/.test(w.origin ?? '')),
    'second-person should not warn',
  );
});

test('page opening with "この教材は" emits Personalization warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    paragraph('この教材は Unreal Engine の入門資料です'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /page-opens-with-doc-description/.test(w.origin ?? '')),
    'page-opens-with-doc-description should warn',
  );
});

test('Verify describing internal mechanics emits warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('Destroy Actor が実行されました')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /verify-internal-mechanics/.test(w.origin ?? '')),
    'verify-internal-mechanics should warn',
  );
});

test('Concept with 6 sentences emits concept-length warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      jsxElement(
        'Concept',
        { title: 'コリジョン' },
        paragraph('文1です。文2です。文3です。文4です。文5です。文6です。'),
      ),
      action({ img: './a.png' }, paragraph('コリジョンを設定します')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /concept-length/.test(w.origin ?? '')),
    'concept-length should warn',
  );
});

test('Concept with no following usage site emits concept-placement warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Concept', { title: '終わったあとの用語' }, paragraph('短い説明')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /concept-placement/.test(w.origin ?? '')),
    'concept-placement should warn when no usage site follows',
  );
});

test('Concept immediately before Action does not warn', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      jsxElement('Concept', { title: '用語' }, paragraph('短い説明')),
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    !warnings.some((w) => /concept-placement/.test(w.origin ?? '')),
    'concept placed before a usage site should not warn',
  );
});

test('Section with Action but no feedback surface emits section-lacks-feedback', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
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
  const tree = root(
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

test('decorative emoji outside signaling surface emits warning', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    paragraph('楽しく進めましょう 🎉'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    warnings.some((w) => /decorative-emoji/.test(w.origin ?? '')),
    'decorative-emoji should warn',
  );
});

test('signalling emoji (✅) inside Checkpoint is allowed', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('✅ done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  plugin()(tree, file);
  assert.ok(
    !warnings.some((w) => /decorative-emoji/.test(w.origin ?? '')),
    '✅ inside Checkpoint should not warn',
  );
});

test('TUTORIAL_LINT_STRICT=1 promotes warnings into build-failing errors', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    paragraph('楽しく進めましょう 🎉'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file } = createVFileStub();
  const prev = process.env.TUTORIAL_LINT_STRICT;
  process.env.TUTORIAL_LINT_STRICT = '1';
  try {
    assert.throws(() => plugin()(tree, file), /decorative-emoji.*\[strict\]/);
  } finally {
    if (prev === undefined) delete process.env.TUTORIAL_LINT_STRICT;
    else process.env.TUTORIAL_LINT_STRICT = prev;
  }
});

test('TUTORIAL_LINT_STRICT unset leaves warnings as warnings', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    paragraph('楽しく進めましょう 🎉'),
    section(
      { goal: 'foo します' },
      action({ img: './a.png' }, paragraph('進めます')),
      jsxElement('Verify', {}, paragraph('成功')),
      jsxElement('Checkpoint', {}, paragraph('done')),
    ),
  );
  const { file, warnings } = createVFileStub();
  const prev = process.env.TUTORIAL_LINT_STRICT;
  delete process.env.TUTORIAL_LINT_STRICT;
  try {
    assert.doesNotThrow(() => plugin()(tree, file));
    assert.ok(warnings.some((w) => /decorative-emoji/.test(w.origin ?? '')));
  } finally {
    if (prev !== undefined) process.env.TUTORIAL_LINT_STRICT = prev;
  }
});

test('TUTORIAL_LINT_COLLECT=1 accumulates every finding and fails once with all of them', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
    // Triggers page-opens-with-doc-description.
    paragraph('この教材は Unreal Engine の入門資料です'),
    // Triggers third-person-reader.
    paragraph('受講者が操作を行います'),
    // Triggers decorative-emoji outside signalling surface.
    paragraph('楽しく 🎉'),
    section(
      { goal: 'foo します' },
      // Triggers action-bold-overuse (four bold spans).
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
          { type: 'text', value: ' を選びます' },
        ),
      ),
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
    assert.ok(thrown, 'collect-all mode should throw one aggregated failure');
    const body = String(thrown.reason ?? thrown.message ?? '');
    assert.match(body, /tutorial-lint: \d+ issue\(s\) found \[collect-all\]/);
    // All four rules that the tree violates should appear in the summary.
    assert.match(body, /page-opens-with-doc-description/);
    assert.match(body, /third-person-reader/);
    assert.match(body, /decorative-emoji/);
    assert.match(body, /action-bold-overuse/);
  } finally {
    if (prevCollect === undefined) delete process.env.TUTORIAL_LINT_COLLECT;
    else process.env.TUTORIAL_LINT_COLLECT = prevCollect;
    if (prevStrict !== undefined) process.env.TUTORIAL_LINT_STRICT = prevStrict;
  }
});

test('TUTORIAL_LINT_COLLECT=1 passes clean documents without throwing', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(
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

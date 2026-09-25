import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const modulePath = '../dist/mdx/tutorial/learning-model.js';
const unit = (id, parent, objective = `Can do ${id}`) => ({
  id,
  objective,
  ...(parent ? { parent } : {}),
});
const jsx = (name, attributes = {}, children = []) => ({
  type: 'mdxJsxFlowElement',
  name,
  attributes: Object.entries(attributes).map(([name, value]) => ({
    type: 'mdxJsxAttribute',
    name,
    value,
  })),
  children,
});
const section = (attributes, ...children) =>
  jsx('Section', { title: 'Goal', ...attributes }, children);
const event = (id, targets, phase, extra = {}) => ({
  id,
  targets,
  phase,
  page: `${id}.mdx`,
  order: 0,
  ...extra,
});

test('learning unit schema accepts leaf and composite hierarchy with stable objectives', async () => {
  const { validateLearningUnitModel } = await import(modulePath);
  assert.deepEqual(
    validateLearningUnitModel({
      version: 1,
      units: [unit('model-scene'), unit('place-object', 'model-scene')],
    }),
    [],
  );
});

test('learning unit schema rejects invalid ID, duplicate ID, missing objective, unknown parent, and cycles', async () => {
  const { validateLearningUnitModel } = await import(modulePath);
  const issues = validateLearningUnitModel({
    version: 1,
    units: [
      { id: 'Bad ID', objective: ' ' },
      { id: 'missing-objective' },
      unit('duplicate'),
      unit('duplicate'),
      unit('orphan', 'missing'),
      unit('cycle-a', 'cycle-b'),
      unit('cycle-b', 'cycle-a'),
    ],
  });
  const messages = issues.map((issue) => issue.message).join('\n');
  for (const expected of [
    /lowercase kebab-case/u,
    /Duplicate learning unit ID/u,
    /objective text/u,
    /unknown parent/u,
    /cycle/u,
  ])
    assert.match(messages, expected);
});

test('page collector keeps legacy pages and grouping Sections unchanged', async () => {
  const { collectLearningContent } = await import(modulePath);
  const legacy = collectLearningContent({ type: 'root', children: [section({})] }, 'legacy.mdx');
  assert.deepEqual(legacy.events, []);
  assert.deepEqual(legacy.issues, []);
});

test('page collector accepts I-PS, PS-I, and Productive Failure stage order', async () => {
  const { collectLearningContent } = await import(modulePath);
  const cases = [
    ['instruction-first', [jsx('Instruction'), jsx('ProblemSolving')]],
    ['problem-solving-first', [jsx('ProblemSolving'), jsx('Instruction')]],
    ['problem-solving-first', [jsx('ProblemSolving'), jsx('Instruction')], 'productive-failure'],
  ];
  for (const [pattern, stages, strategy] of cases) {
    const result = collectLearningContent(
      {
        type: 'root',
        children: [
          section(
            {
              eventId: 'first-pass',
              targets: 'unit-a',
              phase: 'initial',
              pattern,
              ...(strategy ? { strategy } : {}),
            },
            ...stages,
          ),
        ],
      },
      'lesson.mdx',
    );
    assert.deepEqual(result.issues, []);
  }
});

test('page collector deterministically rejects incomplete or reversed learning stages', async () => {
  const { collectLearningContent } = await import(modulePath);
  const check = (pattern, stages, strategy) =>
    collectLearningContent(
      {
        type: 'root',
        children: [
          section(
            {
              eventId: 'event-a',
              targets: 'unit-a',
              phase: 'initial',
              pattern,
              ...(strategy ? { strategy } : {}),
            },
            ...stages,
          ),
        ],
      },
      'lesson.mdx',
    ).issues;
  assert.match(
    check('instruction-first', [jsx('ProblemSolving'), jsx('Instruction')])
      .map((issue) => issue.message)
      .join('\n'),
    /instruction-first/u,
  );
  assert.match(
    check('problem-solving-first', [jsx('Instruction'), jsx('ProblemSolving')])
      .map((issue) => issue.message)
      .join('\n'),
    /problem-solving-first/u,
  );
  assert.match(
    check('problem-solving-first', [jsx('Instruction')], 'productive-failure')
      .map((issue) => issue.message)
      .join('\n'),
    /<ProblemSolving>/u,
  );
  assert.match(
    check('problem-solving-first', [jsx('ProblemSolving')], 'productive-failure')
      .map((issue) => issue.message)
      .join('\n'),
    /<Instruction>/u,
  );
});

test('course progression distinguishes composites, leaf coverage, later recurrence, and evidence', async () => {
  const { analyzeLearningProgression } = await import(modulePath);
  const units = [unit('scene'), unit('place', 'scene'), unit('select', 'scene'), unit('unused')];
  const events = [
    event('introduce-place', ['place'], 'initial', { pattern: 'instruction-first' }),
    event('retrieve-place', ['place'], 'retrieval'),
    event('transfer-select', ['select'], 'transfer'),
  ];
  const evidence = [
    {
      targets: ['place'],
      demonstrates: 'application',
      eventId: 'introduce-place',
      page: 'intro.mdx',
    },
    { targets: ['place'], demonstrates: 'retrieval', eventId: 'retrieve-place', page: 'later.mdx' },
    {
      targets: ['select'],
      demonstrates: 'transfer',
      eventId: 'transfer-select',
      page: 'transfer.mdx',
    },
  ];
  const result = analyzeLearningProgression({ units, events, evidence });
  assert.equal(result.progression[0].kind, 'composite');
  assert.equal(result.progression[0].directCoverage.events, 0);
  assert.equal(result.progression[0].descendantCoverage.events, 3);
  assert.equal(result.progression[1].kind, 'leaf');
  assert.equal(result.progression[1].initialIntroductions.length, 1);
  assert.deepEqual(
    result.progression[1].laterRecurrence.map(({ phase }) => phase),
    ['retrieval'],
  );
  assert.deepEqual(result.progression[1].evidence, ['application', 'retrieval']);
  assert.match(
    result.issues.map((issue) => issue.message).join('\n'),
    /Leaf learning unit "unused" has no learning event/u,
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /distributed practice detected|distributedRecurrence/u,
  );
});

test('course progression rejects duplicate cross-page event IDs, unknown targets, and multiple initial introductions', async () => {
  const { analyzeLearningProgression } = await import(modulePath);
  const result = analyzeLearningProgression({
    units: [unit('known')],
    events: [
      event('same-id', ['known', 'missing'], 'initial'),
      event('same-id', ['known'], 'initial', { page: 'another-page.mdx' }),
    ],
    evidence: [
      { targets: ['missing'], demonstrates: 'transfer', page: 'other.mdx', eventId: 'same-id' },
    ],
  });
  const messages = result.issues.map((issue) => issue.message).join('\n');
  assert.match(messages, /Duplicate learning event ID/u);
  assert.match(messages, /unknown learning unit/u);
  assert.match(messages, /multiple initial introductions/u);
});

test('course analyzer respects Nextra metadata order and labels deterministic fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-analysis-order-'));
  try {
    await mkdir(path.join(root, 'content'), { recursive: true });
    await writeFile(
      path.join(root, 'learning-units.yaml'),
      'version: 1\nunits:\n  - id: unit-a\n    objective: Can do the task.\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'content', '_meta.ts'),
      'const meta = { second: {}, first: {}, "*": {}, hidden: { display: "hidden" } };\nexport default meta;\n',
      'utf8',
    );
    const mdx = (id) =>
      `<Section title="Goal" goal="Goal" eventId="${id}" targets="unit-a" phase="initial" pattern="instruction-first">\n<Instruction>Learn.</Instruction>\n<ProblemSolving>Try.</ProblemSolving>\n</Section>`;
    await writeFile(path.join(root, 'content', 'first.mdx'), mdx('first-event'), 'utf8');
    await writeFile(path.join(root, 'content', 'second.mdx'), mdx('second-event'), 'utf8');
    await writeFile(path.join(root, 'content', 'unlisted.mdx'), mdx('unlisted-event'), 'utf8');
    const { analyzeCourseLearning } = await import('../../../scripts/learning-analysis.mjs');
    const result = await analyzeCourseLearning({ root });
    assert.deepEqual(
      result.events.map(({ id }) => id),
      ['second-event', 'first-event', 'unlisted-event'],
    );
    assert.deepEqual(result.pageOrder, {
      source: 'Nextra _meta.ts; stable path fallback for unlisted pages',
      certain: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Nextra metadata ordering is parsed statically without executing content code', async () => {
  const { parseNextraMetaOrder } = await import('../../../scripts/learning-analysis.mjs');
  assert.deepEqual(
    parseNextraMetaOrder(
      `const meta = { intro: {}, flexbox: {}, exercises: {} }; export default meta;`,
    ),
    {
      supported: true,
      entries: [
        { key: 'intro', hidden: false },
        { key: 'flexbox', hidden: false },
        { key: 'exercises', hidden: false },
      ],
    },
  );
  assert.deepEqual(parseNextraMetaOrder(`export default { intro: {}, flexbox: {} };`), {
    supported: true,
    entries: [
      { key: 'intro', hidden: false },
      { key: 'flexbox', hidden: false },
    ],
  });
  assert.deepEqual(
    parseNextraMetaOrder(`export default { intro: "Introduction", flexbox: "Layout" };`),
    {
      supported: true,
      entries: [
        { key: 'intro', hidden: false },
        { key: 'flexbox', hidden: false },
      ],
    },
  );
  assert.deepEqual(
    parseNextraMetaOrder(`export default { "*": {}, hidden: { display: "hidden" }, visible: {} };`),
    {
      supported: true,
      entries: [
        { key: '*', hidden: false },
        { key: 'hidden', hidden: true },
        { key: 'visible', hidden: false },
      ],
    },
  );

  const marker = '__courseDocsMetaCodeMustNotExecute';
  delete globalThis[marker];
  const staticWithSideEffect = parseNextraMetaOrder(
    `globalThis.${marker} = true; export default { lesson: {} };`,
  );
  assert.equal(staticWithSideEffect.supported, true);
  assert.equal(globalThis[marker], undefined);
  const unsupported = parseNextraMetaOrder(
    `function buildMeta() { throw new Error('metadata code executed'); } export default buildMeta();`,
  );
  assert.deepEqual(unsupported, { supported: false, entries: [] });
  assert.equal(globalThis[marker], undefined);
});

test('unsupported dynamic Nextra metadata uses a stable path fallback and reports uncertain order', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'learning-analysis-dynamic-meta-'));
  try {
    await mkdir(path.join(root, 'content'), { recursive: true });
    await writeFile(
      path.join(root, 'learning-units.yaml'),
      'version: 1\nunits:\n  - id: unit-a\n    objective: Can do the task.\n',
      'utf8',
    );
    await writeFile(
      path.join(root, 'content', '_meta.ts'),
      "function buildMeta() { throw new Error('metadata code executed'); }\nexport default buildMeta();\n",
      'utf8',
    );
    await writeFile(
      path.join(root, 'content', 'lesson.mdx'),
      [
        '<Section title="Goal" goal="Goal" eventId="event-a" targets="unit-a" phase="initial" pattern="instruction-first">',
        '',
        '<Instruction>',
        'Learn.',
        '</Instruction>',
        '',
        '<ProblemSolving>',
        'Try.',
        '</ProblemSolving>',
        '',
        '</Section>',
      ].join('\n'),
      'utf8',
    );
    const { analyzeCourseLearning } = await import('../../../scripts/learning-analysis.mjs');
    const result = await analyzeCourseLearning({ root });
    assert.deepEqual(
      result.events.map(({ id }) => id),
      ['event-a'],
    );
    assert.equal(result.pageOrder.certain, false);
    assert.equal(
      result.issues.some(({ severity }) => severity === 'error'),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

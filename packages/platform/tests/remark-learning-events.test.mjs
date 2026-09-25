import assert from 'node:assert/strict';
import test from 'node:test';

const pluginPath = '../dist/mdx/tutorial/remark-learning-events.js';
const element = (name, attributes = {}, children = []) => ({
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
  element('Section', { title: 'Goal', goal: 'Goal', ...attributes }, children);
const initial = (overrides = {}) => ({
  eventId: 'first-pass',
  targets: 'unit-a',
  phase: 'initial',
  pattern: 'instruction-first',
  ...overrides,
});
const validStages = [element('Instruction'), element('ProblemSolving')];
const run = async (tree) => {
  const { default: plugin } = await import(pluginPath);
  plugin()(tree, {
    path: 'content/lesson.mdx',
    fail(message) {
      throw new Error(message);
    },
  });
};

test('legacy Section without learning metadata remains compatible', async () => {
  await assert.doesNotReject(() => run({ type: 'root', children: [section({})] }));
});

test('event attributes require stable ID, targets, phase, and valid phase-specific pattern', async () => {
  await assert.rejects(
    () => run({ type: 'root', children: [section(initial({ eventId: 'Bad ID' }))] }),
    /stable ID/u,
  );
  await assert.rejects(
    () => run({ type: 'root', children: [section(initial({ targets: '' }))] }),
    /missing or invalid targets/u,
  );
  await assert.rejects(
    () => run({ type: 'root', children: [section({ eventId: 'event-a', targets: 'unit-a' })] }),
    /eventId, targets, and phase together/u,
  );
  await assert.rejects(
    () => run({ type: 'root', children: [section(initial({ phase: 'spacing' }))] }),
    /invalid phase/u,
  );
  await assert.rejects(
    () => run({ type: 'root', children: [section({ ...initial(), pattern: undefined })] }),
    /must declare a learning pattern/u,
  );
  await assert.rejects(
    () => run({ type: 'root', children: [section({ ...initial(), pattern: 'default' })] }),
    /invalid learning pattern/u,
  );
  await assert.doesNotReject(() =>
    run({
      type: 'root',
      children: [section({ ...initial(), phase: 'retrieval', pattern: undefined })],
    }),
  );
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [
          section({
            eventId: 'later',
            targets: 'unit-a',
            phase: 'retrieval',
            pattern: 'instruction-first',
          }),
        ],
      }),
    /cannot declare a learning pattern/u,
  );
});

test('initial instruction-first and problem-solving-first structures are validated from explicit stages', async () => {
  await assert.doesNotReject(() =>
    run({ type: 'root', children: [section(initial(), ...validStages)] }),
  );
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [section(initial(), element('ProblemSolving'), element('Instruction'))],
      }),
    /instruction-first/u,
  );
  await assert.doesNotReject(() =>
    run({
      type: 'root',
      children: [
        section(
          initial({ pattern: 'problem-solving-first' }),
          element('ProblemSolving'),
          element('Instruction'),
        ),
      ],
    }),
  );
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [section(initial({ pattern: 'problem-solving-first' }), ...validStages)],
      }),
    /problem-solving-first/u,
  );
});

test('Productive Failure requires problem-solving-first plus both ordered stage markers', async () => {
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [
          section(
            initial({ pattern: 'problem-solving-first', strategy: 'productive-failure' }),
            ...validStages,
          ),
        ],
      }),
    /problem-solving-first/u,
  );
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [
          section(
            initial({ pattern: 'problem-solving-first', strategy: 'productive-failure' }),
            element('ProblemSolving'),
          ),
        ],
      }),
    /problem-solving-first/u,
  );
  await assert.doesNotReject(() =>
    run({
      type: 'root',
      children: [
        section(
          initial({ pattern: 'problem-solving-first', strategy: 'productive-failure' }),
          element('ProblemSolving'),
          element('Instruction'),
        ),
      ],
    }),
  );
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [
          section(
            initial({ phase: 'practice', pattern: undefined, strategy: 'productive-failure' }),
          ),
        ],
      }),
    /Productive Failure/u,
  );
});

test('Event boundaries allow non-event grouping but reject nested learning events', async () => {
  await assert.doesNotReject(() =>
    run({
      type: 'root',
      children: [section({ title: 'Grouping' }, section(initial(), ...validStages))],
    }),
  );
  const outer = section(
    initial(),
    section({ title: 'Grouping' }),
    section(initial({ eventId: 'nested-event' }), ...validStages),
  );
  await assert.rejects(() => run({ type: 'root', children: [outer] }), /nested inside event/u);
});

test('Evidence validates targets, kind, placement, and one direct assessment child', async () => {
  const evidence = (attributes = {}, children = [element('Exercise')]) =>
    element(
      'Evidence',
      { targets: 'unit-a', demonstrates: 'application', ...attributes },
      children,
    );
  await assert.doesNotReject(() =>
    run({ type: 'root', children: [section(initial(), ...validStages, evidence())] }),
  );
  await assert.doesNotReject(() =>
    run({
      type: 'root',
      children: [
        section(
          initial(),
          ...validStages,
          evidence({ demonstrates: 'application' }, [element('Exercise')]),
        ),
      ],
    }),
  );
  await assert.rejects(
    () =>
      run({ type: 'root', children: [section(initial(), evidence({ demonstrates: 'magic' }))] }),
    /application, retrieval, or transfer/u,
  );
  await assert.rejects(
    () => run({ type: 'root', children: [section(initial(), evidence({ targets: 'unit-b' }))] }),
    /not declared by event/u,
  );
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [
          element('Evidence', { targets: 'unit-a', demonstrates: 'retrieval' }, [
            element('QuickCheck'),
          ]),
        ],
      }),
    /outside a learning event/u,
  );
  await assert.rejects(
    () =>
      run({
        type: 'root',
        children: [section(initial(), evidence({}, [element('Exercise'), element('Verify')]))],
      }),
    /exactly one/u,
  );
  await assert.rejects(
    () =>
      run({ type: 'root', children: [section(initial(), evidence({}, [element('Recovery')]))] }),
    /exactly one/u,
  );
  await assert.rejects(
    () => run({ type: 'root', children: [section(initial(), evidence({ targets: '' }))] }),
    /requires valid/u,
  );
});

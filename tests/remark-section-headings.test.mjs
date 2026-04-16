import assert from 'node:assert/strict';
import test from 'node:test';

const pluginModulePath = '../dist/mdx/remark-section-headings.js';

const section = (title, children = []) => ({
  type: 'mdxJsxFlowElement',
  name: 'Section',
  attributes: [{ type: 'mdxJsxAttribute', name: 'title', value: title }],
  children,
});

const exercise = (children = []) => ({
  type: 'mdxJsxFlowElement',
  name: 'Exercise',
  attributes: [],
  children,
});

const other = (name, children = []) => ({
  type: 'mdxJsxFlowElement',
  name,
  attributes: [],
  children,
});

const getInjectedHeading = (node) => {
  const first = node.children[0];
  if (!first || first.type !== 'heading') return null;
  return first;
};

const getDepthAttribute = (node) => {
  const attr = node.attributes.find((a) => a?.name === 'depth');
  if (!attr) return null;
  if (attr.value && typeof attr.value === 'object' && 'value' in attr.value) {
    return Number(attr.value.value);
  }
  return null;
};

test('top-level Section is assigned depth 0 and h2', async () => {
  const { default: remarkSectionHeadings } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [section('Step 1')],
  };

  remarkSectionHeadings()(tree);

  const step1 = tree.children[0];
  assert.equal(getDepthAttribute(step1), 0);
  assert.equal(getInjectedHeading(step1)?.depth, 2);
  assert.equal(getInjectedHeading(step1)?.children[0]?.value, 'Step 1');
});

test('Section nested in Section is assigned depth 1 and h3', async () => {
  const { default: remarkSectionHeadings } = await import(pluginModulePath);

  const inner = section('1-1. Sub');
  const outer = section('Step 1', [inner]);
  const tree = { type: 'root', children: [outer] };

  remarkSectionHeadings()(tree);

  assert.equal(getDepthAttribute(inner), 1);
  assert.equal(getInjectedHeading(inner)?.depth, 3);
});

test('Section inside Exercise is shifted one level deeper', async () => {
  const { default: remarkSectionHeadings } = await import(pluginModulePath);

  const inner = section('Guided walkthrough');
  const tree = {
    type: 'root',
    children: [exercise([inner])],
  };

  remarkSectionHeadings()(tree);

  assert.equal(getDepthAttribute(inner), 1);
  assert.equal(getInjectedHeading(inner)?.depth, 3);
});

test('Section inside Exercise inside Section accumulates depth', async () => {
  const { default: remarkSectionHeadings } = await import(pluginModulePath);

  const inner = section('Inner sub-goal');
  const outer = section('Step 4', [exercise([inner])]);
  const tree = { type: 'root', children: [outer] };

  remarkSectionHeadings()(tree);

  assert.equal(getDepthAttribute(outer), 0);
  assert.equal(getInjectedHeading(outer)?.depth, 2);
  assert.equal(getDepthAttribute(inner), 2);
  assert.equal(getInjectedHeading(inner)?.depth, 4);
});

test('Exercise without an inner Section does not affect siblings', async () => {
  const { default: remarkSectionHeadings } = await import(pluginModulePath);

  const sibling = section('Sibling milestone');
  const tree = {
    type: 'root',
    children: [exercise([other('Action')]), sibling],
  };

  remarkSectionHeadings()(tree);

  assert.equal(getDepthAttribute(sibling), 0);
  assert.equal(getInjectedHeading(sibling)?.depth, 2);
});

test('heading depth caps at h6 regardless of nesting', async () => {
  const { default: remarkSectionHeadings } = await import(pluginModulePath);

  // Exercise > Section > Exercise > Section > Exercise > Section > Section
  // would otherwise produce h8.
  const deepest = section('Deepest');
  const wrapper5 = section('W5', [deepest]);
  const wrapper4 = exercise([wrapper5]);
  const wrapper3 = section('W3', [wrapper4]);
  const wrapper2 = exercise([wrapper3]);
  const wrapper1 = section('W1', [wrapper2]);
  const tree = { type: 'root', children: [exercise([wrapper1])] };

  remarkSectionHeadings()(tree);

  assert.equal(getInjectedHeading(deepest)?.depth, 6);
});

test('plugin is idempotent across repeated runs', async () => {
  const { default: remarkSectionHeadings } = await import(pluginModulePath);

  const inner = section('Inner');
  const tree = { type: 'root', children: [exercise([inner])] };

  const transform = remarkSectionHeadings();
  transform(tree);
  transform(tree);

  const headings = inner.children.filter((c) => c.type === 'heading');
  assert.equal(headings.length, 1);
  assert.equal(headings[0].depth, 3);
  assert.equal(getDepthAttribute(inner), 1);
});

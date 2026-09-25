import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { unified } from 'unified';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';

const docsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/learning-system.md',
);
const taskStructurePath = '../dist/mdx/remark-task-structure.js';

const collectMdxExamples = (node, examples = []) => {
  if (node.type === 'code' && node.lang === 'mdx') examples.push(node.value);
  for (const child of node.children ?? []) collectMdxExamples(child, examples);
  return examples;
};

test('all canonical MDX examples in learning-system docs satisfy the task structure contract', async () => {
  const source = await readFile(docsPath, 'utf8');
  const docsTree = unified().use(remarkParse).use(remarkMdx).parse(source);
  const examples = collectMdxExamples(docsTree);
  assert.ok(examples.length > 0, 'docs should include canonical MDX examples');
  const { default: remarkTaskStructure } = await import(taskStructurePath);
  const { default: remarkLearningEvents } =
    await import('../dist/mdx/tutorial/remark-learning-events.js');
  const validate = remarkTaskStructure();
  const validateLearningEvents = remarkLearningEvents();

  for (const [index, example] of examples.entries()) {
    const tree = unified().use(remarkParse).use(remarkMdx).parse(example);
    const file = {
      path: `docs/learning-system.md MDX example ${index + 1}`,
      fail(reason) {
        throw new Error(reason);
      },
    };
    assert.doesNotThrow(() => validate(tree, file), `MDX example ${index + 1} task structure`);
    if (example.includes('eventId='))
      assert.doesNotThrow(
        () => validateLearningEvents(tree, file),
        `MDX example ${index + 1} learning event structure`,
      );
  }
});

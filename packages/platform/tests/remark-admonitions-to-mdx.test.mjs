import assert from 'node:assert/strict';
import test from 'node:test';

const pluginModulePath = '../dist/mdx/remark-admonitions-to-mdx.js';

const createVFileStub = () => ({
  fail(message) {
    throw new Error(message);
  },
});

test('supported admonitions transform into <Admonition> nodes', async () => {
  const { default: remarkAdmonitionsToMdx } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      {
        type: 'containerDirective',
        name: 'important',
        label: '重要',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: '本文' }] }],
      },
    ],
  };

  const transform = remarkAdmonitionsToMdx();
  transform(tree, createVFileStub());

  const node = tree.children[0];
  assert.equal(node.type, 'mdxJsxFlowElement');
  assert.equal(node.name, 'Admonition');
  assert.equal(node.attributes.find((attr) => attr.name === 'type')?.value, 'important');
  assert.equal(node.attributes.find((attr) => attr.name === 'title')?.value, '重要');
});

test('unsupported admonitions fail with a suggested replacement', async () => {
  const { default: remarkAdmonitionsToMdx } = await import(pluginModulePath);

  const tree = {
    type: 'root',
    children: [
      {
        type: 'containerDirective',
        name: 'info',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: '本文' }] }],
      },
    ],
  };

  const transform = remarkAdmonitionsToMdx();

  assert.throws(
    () => transform(tree, createVFileStub()),
    /Unsupported admonition type "info"\. Supported types: tip, note, warning, caution, important\. Did you mean "note"\?/,
  );
});

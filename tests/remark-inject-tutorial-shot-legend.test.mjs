import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const pluginModulePath = '../dist/mdx/remark-inject-tutorial-shot-legend.js';

// ---------------------------------------------------------------------------
// AST builders
// ---------------------------------------------------------------------------

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

const paragraph = (text) => ({
  type: 'paragraph',
  children: [{ type: 'text', value: text }],
});

const root = (...children) => ({ type: 'root', children });

// Wrap an Action inside a Section-like container (Action is a child of
// a JSX element, not a direct child of root).
const sectionWrapper = (...children) => ({
  type: 'mdxJsxFlowElement',
  name: 'Section',
  attributes: [{ type: 'mdxJsxAttribute', name: 'goal', value: 'test goal' }],
  children,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Creates a temp directory and writes a shot.json file, returning the
// directory path and the img attribute value the plugin expects.
const makeShotFixture = ({ annotations }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-legend-test-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  const stem = `test-shot-${randomUUID()}`;
  const manifest = { annotations, annotationMode: 'callout', alt: '' };
  fs.writeFileSync(path.join(dir, 'shots', `${stem}.shot.json`), JSON.stringify(manifest), 'utf-8');
  return {
    dir,
    imgAttr: `./img/${stem}.png`,
    shotPath: path.join(dir, 'shots', `${stem}.shot.json`),
    mdxPath: path.join(dir, 'index.mdx'),
  };
};

// Returns the names of all injected <Concept> nodes found in a tree.
const findConcepts = (tree) => {
  const results = [];
  const walk = (node) => {
    if (node.type === 'mdxJsxFlowElement' && node.name === 'Concept') {
      results.push(node);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return results;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('skips when vfile has no path', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(action({ img: './img/shot.png' }, paragraph('text')));
  plugin()(tree, {}); // no path → no injection
  assert.equal(findConcepts(tree).length, 0);
});

test('skips when img attr does not match ./img/<stem>.png pattern', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const tree = root(action({ img: './screenshots/shot.png' }, paragraph('text')));
  plugin()(tree, { path: '/some/mdx/index.mdx' });
  assert.equal(findConcepts(tree).length, 0);
});

test('skips when no shot.json exists for the img', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-legend-test-'));
  // No shots/ directory created — file will not exist.
  const tree = root(action({ img: './img/nonexistent.png' }, paragraph('text')));
  plugin()(tree, { path: path.join(dir, 'index.mdx') });
  assert.equal(findConcepts(tree).length, 0);
});

test('skips when all annotations are "action" (no verify)', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const { dir, imgAttr, mdxPath } = makeShotFixture({
    annotations: [{ role: 'action' }, { role: 'action' }],
  });
  const tree = root(action({ img: imgAttr }, paragraph('text')));
  plugin()(tree, { path: mdxPath });
  assert.equal(findConcepts(tree).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('skips when all annotations are "verify" (no action)', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const { dir, imgAttr, mdxPath } = makeShotFixture({
    annotations: [{ role: 'verify' }, { role: 'verify' }],
  });
  const tree = root(action({ img: imgAttr }, paragraph('text')));
  plugin()(tree, { path: mdxPath });
  assert.equal(findConcepts(tree).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('injects a Concept before the first mixed-role Action at root level', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const { dir, imgAttr, mdxPath } = makeShotFixture({
    annotations: [{ role: 'verify' }, { role: 'action' }],
  });
  const tree = root(action({ img: imgAttr }, paragraph('操作します')));
  plugin()(tree, { path: mdxPath });

  const concepts = findConcepts(tree);
  assert.equal(concepts.length, 1, 'exactly one Concept injected');

  // Concept must appear before the Action at index 0.
  assert.equal(tree.children[0].name, 'Concept', 'Concept is first child');
  assert.equal(tree.children[1].name, 'Action', 'Action follows Concept');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('injects Concept inside a Section parent (not just at root)', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const { dir, imgAttr, mdxPath } = makeShotFixture({
    annotations: [{ role: 'verify' }, { role: 'action' }],
  });
  const section = sectionWrapper(action({ img: imgAttr }, paragraph('操作します')));
  const tree = root(section);
  plugin()(tree, { path: mdxPath });

  const concepts = findConcepts(tree);
  assert.equal(concepts.length, 1, 'exactly one Concept injected');

  // Concept is inside the section, not at root level.
  assert.equal(tree.children.length, 1, 'root still has one Section');
  assert.equal(section.children[0].name, 'Concept', 'Concept is first child of Section');
  assert.equal(section.children[1].name, 'Action', 'Action follows Concept inside Section');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('injects only once even when multiple mixed-role shots appear on the page', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const shot1 = makeShotFixture({
    annotations: [{ role: 'verify' }, { role: 'action' }],
  });
  const shot2 = makeShotFixture({
    annotations: [{ role: 'verify' }, { role: 'action' }],
  });
  // Both fixtures use the same dir for mdxPath.
  const mdxPath = shot1.mdxPath;
  // Copy shot2's shot.json into shot1's shots directory.
  const shot2Stem = path.basename(shot2.shotPath, '.shot.json');
  fs.cpSync(shot2.shotPath, path.join(shot1.dir, 'shots', `${shot2Stem}.shot.json`));
  const shot2ImgAttr = `./img/${shot2Stem}.png`;

  const tree = root(
    action({ img: shot1.imgAttr }, paragraph('操作1')),
    action({ img: shot2ImgAttr }, paragraph('操作2')),
  );
  plugin()(tree, { path: mdxPath });

  const concepts = findConcepts(tree);
  assert.equal(concepts.length, 1, 'only one Concept injected for multiple shots');
  assert.equal(tree.children[0].name, 'Concept', 'Concept precedes first Action');

  fs.rmSync(shot1.dir, { recursive: true, force: true });
  fs.rmSync(shot2.dir, { recursive: true, force: true });
});

test('Concept has a title attribute so the summary is not empty', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const { dir, imgAttr, mdxPath } = makeShotFixture({
    annotations: [{ role: 'verify' }, { role: 'action' }],
  });
  const tree = root(action({ img: imgAttr }, paragraph('text')));
  plugin()(tree, { path: mdxPath });

  const [concept] = findConcepts(tree);
  assert.ok(concept, 'Concept was injected');

  const titleAttr = concept.attributes.find((a) => a.name === 'title');
  assert.ok(titleAttr, 'Concept has a title attribute');
  assert.ok(
    typeof titleAttr.value === 'string' && titleAttr.value.length > 0,
    'title is a non-empty string',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Concept children contain verify and action descriptions', async () => {
  const { default: plugin } = await import(pluginModulePath);
  const { dir, imgAttr, mdxPath } = makeShotFixture({
    annotations: [{ role: 'verify' }, { role: 'action' }],
  });
  const tree = root(action({ img: imgAttr }, paragraph('text')));
  plugin()(tree, { path: mdxPath });

  const [concept] = findConcepts(tree);
  assert.ok(concept, 'Concept was injected');

  // Flatten text content of the Concept for easy assertion.
  const allText = (node) => {
    if (node.type === 'text') return node.value;
    return (node.children ?? []).map(allText).join('');
  };
  const text = allText(concept);

  assert.ok(text.includes('白い破線'), 'Concept mentions verify visual (白い破線)');
  assert.ok(text.includes('オレンジの実線'), 'Concept mentions action visual (オレンジの実線)');
  assert.ok(text.includes('確認項目'), 'Concept mentions verify role');
  assert.ok(text.includes('操作項目'), 'Concept mentions action role');

  fs.rmSync(dir, { recursive: true, force: true });
});

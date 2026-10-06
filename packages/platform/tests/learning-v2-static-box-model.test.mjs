import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileLearningSourceV2 } from '../dist/learning-v2/compiler.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(packageRoot, 'tests/fixtures/learning-v2/box-model-static.json');
const goldenPath = path.join(
  packageRoot,
  'tests/fixtures/learning-v2/box-model-static.bundle.json',
);
const repoRoot = path.resolve(packageRoot, '../..');
const loadSource = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const compile = () => compileLearningSourceV2(loadSource());

const assertFinalEvidenceAttribution = (source) => {
  const activities = new Map(source.activities.map((activity) => [activity.id, activity]));
  const expected = new Map([
    ['final-profile-selector', 'css-class-selector-generate-evidence'],
    ['final-profile-width', 'css-size-property-select-evidence'],
    ['final-profile-border', 'css-border-shorthand-evidence'],
    ['final-profile-padding', 'css-padding-single-value-generate-evidence'],
  ]);
  for (const [activityId, evidenceId] of expected)
    assert.deepEqual(activities.get(activityId).evidenceSpecIds, [evidenceId]);
};

const declarations = (css) =>
  new Map(
    [...css.matchAll(/^\s*([a-z-]+):\s*([^;]+);\s*$/gm)].map(([, property, value]) => [
      property,
      value,
    ]),
  );

const assertOnlyDeclarationChanges = (beforeCss, afterCss, expectedChanges) => {
  const before = declarations(beforeCss);
  const after = declarations(afterCss);
  const properties = new Set([...before.keys(), ...after.keys()]);
  const changes = [...properties].filter(
    (property) => before.get(property) !== after.get(property),
  );
  assert.deepEqual(changes.sort(), [...expectedChanges].sort());
};

const expectedCorePlan = [
  'goal-preview',
  'minimal-orientation',
  'p-selector-prediction',
  'concrete-result-reasoning',
  'class-added-only',
  'class-selector-active',
  'waku-independent-generation',
  'price-fresh-variation',
  'width-effect-prediction',
  'height-completion',
  'size-variation',
  'border-effect-prediction',
  'border-generation',
  'border-missing-style-variation',
  'padding-prediction',
  'padding-four-sides',
  'integrated-box-model-prediction',
  'layer-resolution',
  'changed-condition-application',
  'final-profile-selector',
  'final-profile-width',
  'final-profile-border',
  'final-profile-padding',
];

test('full static fixture exists with the required Units, KCs, and fixed core order', () => {
  const source = loadSource();
  const unitIds = source.units.map(({ id }) => id);
  const kcIds = source.knowledgeComponents.map(({ id }) => id);

  assert.deepEqual(unitIds, ['css-class-selector', 'css-box-size', 'css-border', 'css-padding']);
  for (const id of [
    'css-selector-tag-match',
    'css-class-selector-match',
    'css-class-selector-generate',
    'css-size-property-select',
    'css-content-box-size',
    'css-border-role',
    'css-border-shorthand',
    'css-padding-role',
    'css-padding-single-value',
    'css-box-model-layer-relation',
  ])
    assert.ok(kcIds.includes(id), `missing Knowledge Component ${id}`);
  assert.deepEqual(
    source.corePlan.map(({ activityId }) => activityId),
    expectedCorePlan,
  );
});

test('controlled resources preserve the authored width, border, and padding causal changes', () => {
  const source = loadSource();
  const resource = (id) => source.resources.find((item) => item.id === id).payload;
  const base = resource('box-model-card-base-rendering');
  const width = resource('box-model-width-300-rendering');
  const height = resource('box-model-height-220-rendering');
  const bordered = resource('box-model-border-added-rendering');
  const padding20 = resource('box-model-padding-20-rendering');
  const padding30 = resource('box-model-padding-30-rendering');

  assert.equal(base.html, width.html);
  assert.equal(width.html, height.html);
  assert.equal(height.html, bordered.html);
  assert.equal(bordered.html, padding20.html);
  assert.equal(padding20.html, padding30.html);
  assert.match(width.css, /width: 300px;/);
  assert.match(height.css, /height: 220px;/);
  assert.match(bordered.css, /border: 2px solid #7a4b2a;/);
  assert.doesNotMatch(bordered.css, /padding:/);
  assert.match(padding20.css, /padding: 20px;/);
  assert.match(padding30.css, /padding: 30px;/);
  assert.match(resource('box-model-goal-preview-rendering').html, /<h2>チョコドーナツ<\/h2>/);
  assert.match(
    resource('box-model-final-profile-rendering').html,
    /<section class="profile-card">/,
  );
  assert.match(resource('box-model-final-profile-rendering').css, /width: 280px;/);
  assert.match(resource('box-model-final-profile-rendering').css, /border: 3px solid #2563eb;/);
  assert.match(resource('box-model-final-profile-rendering').css, /padding: 16px;/);
  assertOnlyDeclarationChanges(base.css, width.css, ['width']);
  assertOnlyDeclarationChanges(width.css, height.css, ['height']);
  assertOnlyDeclarationChanges(height.css, bordered.css, ['border']);
  assertOnlyDeclarationChanges(bordered.css, padding20.css, ['padding']);
  assertOnlyDeclarationChanges(padding20.css, padding30.css, ['padding']);
});

test('final component Evidence is attributed to separate component Activities', () => {
  assertFinalEvidenceAttribution(loadSource());
});

test('resource and Evidence mutations break the corresponding Gate C contracts', () => {
  const source = loadSource();
  assert.throws(() => {
    const padding = source.resources.find((item) => item.id === 'box-model-padding-20-rendering');
    padding.payload.css = padding.payload.css.replace('  border: 2px solid #7a4b2a;\n', '');
    const bordered = source.resources.find(
      (item) => item.id === 'box-model-border-added-rendering',
    );
    assertOnlyDeclarationChanges(bordered.payload.css, padding.payload.css, ['padding']);
  });
  const evidenceMutation = loadSource();
  evidenceMutation.activities.find(
    (activity) => activity.id === 'final-profile-border',
  ).evidenceSpecIds = [];
  assert.throws(() => assertFinalEvidenceAttribution(evidenceMutation));
});

test('the development pilot compiles the full static source fixture', () => {
  const page = fs.readFileSync(path.join(repoRoot, 'src/app/dev/learning-v2/page.dev.tsx'), 'utf8');
  assert.match(page, /box-model-static\.json/);
  assert.doesNotMatch(page, /box-model-class-selector\.json/);
});

test('full static fixture compiles and matches its human-reviewable golden Bundle', () => {
  const source = loadSource();
  const before = structuredClone(source);
  const { bundle, canonicalJson } = compileLearningSourceV2(source);
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

  assert.deepEqual(bundle, golden);
  assert.equal(bundle.courseId, 'box-model');
  assert.equal(bundle.contentRevision, 'static-v2-reference-1');
  assert.equal(bundle.corePlan.length, 23);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.knowledge), true);
  assert.equal(Object.isFrozen(bundle.corePlan), true);
  assert.deepEqual(source, before);
  assert.match(canonicalJson, /^\{"activityCatalog":/);
});

test('final component prompts do not reveal generated answers before commitment', () => {
  const { bundle } = compile();
  for (const id of [
    'height-completion',
    'final-profile-selector',
    'final-profile-width',
    'final-profile-border',
    'final-profile-padding',
  ]) {
    const activity = bundle.activityCatalog.find((item) => item.id === id);
    const expected = activity.response.expectedResponse;
    const visiblePrompt = activity.content
      .map((node) => (node.kind === 'text' || node.kind === 'code' ? (node.text ?? node.code) : ''))
      .join('\n');
    if (id === 'final-profile-padding') assert.doesNotMatch(visiblePrompt, /padding:\s*16px/);
    else assert.ok(!visiblePrompt.includes(expected), `${id} leaks ${expected} before commitment`);
    assert.equal(activity.feedbackGate.revealMode, 'after-commit');
  }
  const changed = loadSource();
  changed.activities
    .find((activity) => activity.id === 'final-profile-selector')
    .content.push({
      kind: 'text',
      text: '.profile-card',
    });
  assert.throws(() => {
    const activity = changed.activities.find((item) => item.id === 'final-profile-selector');
    const visible = activity.content.map((node) => node.text ?? node.code ?? '').join('\n');
    assert.ok(!visible.includes(activity.response.expectedResponse));
  });
});

test('Gate B class-selector slice retains its accepted activity and resource semantics', () => {
  const { bundle } = compile();
  const oldSource = JSON.parse(
    fs.readFileSync(
      path.join(packageRoot, 'tests/fixtures/learning-v2/box-model-class-selector.json'),
      'utf8',
    ),
  );
  const oldActivities = new Map(oldSource.activities.map((activity) => [activity.id, activity]));
  const fullActivities = new Map(bundle.activityCatalog.map((activity) => [activity.id, activity]));

  for (const id of oldActivities.keys())
    assert.deepEqual(fullActivities.get(id), oldActivities.get(id));
  assert.deepEqual(
    bundle.corePlan.map(({ activityId }) => activityId).slice(1, 8),
    oldSource.corePlan.map(({ activityId }) => activityId),
  );
  for (const id of [
    'box-model-tag-selector-rendering',
    'box-model-class-added-only-rendering',
    'box-model-class-selector-active-rendering',
  ]) {
    assert.deepEqual(
      bundle.resourceManifest.find((item) => item.id === id),
      JSON.parse(
        fs.readFileSync(
          path.join(packageRoot, 'tests/fixtures/learning-v2/box-model-class-selector.json'),
          'utf8',
        ),
      ).resources.find((item) => item.id === id),
    );
  }
});

test('all authored Task, Evidence, and Activity response relationships are compatible', () => {
  const source = loadSource();
  const evidenceById = new Map(source.evidenceSpecs.map((item) => [item.id, item]));
  const familyById = new Map(source.taskFamilies.map((item) => [item.id, item]));

  for (const family of source.taskFamilies) {
    for (const evidenceId of family.canProduceEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      assert.ok(family.targetKnowledgeComponentIds.includes(evidence.targetKnowledgeComponentId));
      assert.equal(family.response.kind, evidence.observable.response);
    }
  }
  for (const activity of source.activities) {
    if (!activity.taskFamilyId) continue;
    const family = familyById.get(activity.taskFamilyId);
    if (activity.response) assert.equal(activity.response.kind, family.response.kind);
    for (const evidenceId of activity.evidenceSpecIds) {
      assert.ok(family.canProduceEvidenceIds.includes(evidenceId));
      if (activity.response)
        assert.equal(activity.response.kind, evidenceById.get(evidenceId).observable.response);
    }
  }
});

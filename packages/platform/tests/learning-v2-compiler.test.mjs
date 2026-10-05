import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compileLearningSourceV2,
  LearningSourceValidationError,
} from '../dist/learning-v2/compiler.js';
import { validateLearningSourceV2 } from '../dist/learning-v2/validation.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(
  packageRoot,
  'tests/fixtures/learning-v2/box-model-class-selector.json',
);
const goldenPath = path.join(
  packageRoot,
  'tests/fixtures/learning-v2/box-model-class-selector.bundle.json',
);
const loadFixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const clone = (value) => structuredClone(value);

const reverseObjectKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
    );
  }
  return value;
};

test('box-model fixture compiles deterministically to an immutable content-addressed Bundle', () => {
  const source = loadFixture();
  const before = clone(source);
  const first = compileLearningSourceV2(source);
  const second = compileLearningSourceV2(source);

  assert.deepEqual(first.bundle, second.bundle);
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.equal(first.bundle.bundleId, second.bundle.bundleId);
  assert.match(first.bundle.bundleId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    first.bundle.bundleId,
    `sha256:${createHash('sha256').update(first.canonicalJson, 'utf8').digest('hex')}`,
  );
  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(first.bundle), true);
  assert.equal(Object.isFrozen(first.bundle.knowledge), true);
  assert.equal(Object.isFrozen(first.bundle.corePlan), true);
  assert.equal(
    Object.isFrozen(first.bundle.taskFamilies[0].linkedContrastSequences[0].steps),
    true,
  );
  assert.equal(Object.isFrozen(first.bundle.resourceManifest[0].payload), true);
});

test('object property insertion order does not affect canonical JSON or Bundle ID', () => {
  const original = compileLearningSourceV2(loadFixture());
  const reordered = compileLearningSourceV2(reverseObjectKeys(loadFixture()));

  assert.equal(original.bundle.bundleId, reordered.bundle.bundleId);
  assert.equal(original.canonicalJson, reordered.canonicalJson);
});

test('meaningful source changes alter the Bundle ID', () => {
  const original = compileLearningSourceV2(loadFixture());
  const mutations = [
    (source) => {
      source.taskFamilies[0].variants[2].dimensions.cssSelector = '.price';
    },
    (source) => {
      [source.corePlan[0], source.corePlan[1]] = [source.corePlan[1], source.corePlan[0]];
    },
    (source) => {
      source.taskFamilies[0].linkedContrastSequences[0].steps = [
        { variantId: 'class-selector-active', changedDimensions: [] },
        { variantId: 'class-added-only', changedDimensions: ['cssSelector'] },
        { variantId: 'tag-selector', changedDimensions: ['htmlClass'] },
      ];
    },
    (source) => {
      source.activities[2].content[0].text = 'Every p element matches the tag selector.';
    },
    (source) => {
      source.taskFamilies[1].variants[1].dimensions.expectedSelector = '.cost';
    },
  ];
  for (const mutate of mutations) {
    const changed = loadFixture();
    mutate(changed);
    assert.notEqual(original.bundle.bundleId, compileLearningSourceV2(changed).bundle.bundleId);
  }
});

test('stable authored IDs and core-plan ordering survive compilation', () => {
  const { bundle } = compileLearningSourceV2(loadFixture());
  const ids = [
    ...bundle.knowledge.units.map(({ id }) => id),
    ...bundle.knowledge.knowledgeComponents.map(({ id }) => id),
    ...bundle.evidenceSpecs.map(({ id }) => id),
    ...bundle.taskFamilies.flatMap(({ id, variants }) => [
      id,
      ...variants.map(({ id: variantId }) => variantId),
    ]),
    ...bundle.taskFamilies.flatMap(({ linkedContrastSequences }) =>
      linkedContrastSequences.map(({ id }) => id),
    ),
    ...bundle.activityCatalog.map(({ id }) => id),
    ...bundle.corePlan.map(({ id }) => id),
    ...bundle.evaluatorSpecs.map(({ id }) => id),
    ...bundle.resourceManifest.map(({ id }) => id),
  ];

  assert.ok(ids.includes('css-class-selector'));
  assert.ok(ids.includes('css-class-selector-match'));
  assert.ok(ids.includes('css-class-selector-generate'));
  assert.ok(ids.includes('css-class-selector-prediction'));
  assert.ok(ids.includes('css-class-selector-match-evidence'));
  assert.ok(ids.includes('css-class-selector-generate-evidence'));
  assert.ok(ids.includes('class-selector-contrast'));
  assert.ok(ids.includes('class-selector-generate'));
  assert.ok(ids.includes('tag-selector'));
  assert.ok(ids.includes('class-added-only'));
  assert.ok(ids.includes('class-selector-active'));
  assert.ok(ids.includes('class-selector-causal-contrast'));
  assert.ok(ids.includes('waku'));
  assert.ok(ids.includes('price'));
  assert.ok(ids.includes('minimal-orientation'));
  assert.ok(ids.includes('step-minimal-orientation'));
  assert.ok(ids.includes('class-selector-css-evaluator'));
  assert.ok(ids.includes('box-model-class-selector-rendering'));
  assert.deepEqual(
    bundle.corePlan.map(({ activityId }) => activityId),
    [
      'minimal-orientation',
      'p-selector-prediction',
      'concrete-result-reasoning',
      'class-added-only',
      'class-selector-active',
      'waku-independent-generation',
      'price-fresh-variation',
    ],
  );
});

test('linked contrast preserves exact class-selector changes and invariants', () => {
  const { bundle } = compileLearningSourceV2(loadFixture());
  const family = bundle.taskFamilies.find(({ id }) => id === 'class-selector-contrast');
  const sequence = family.linkedContrastSequences[0];
  const dimensionsByVariant = new Map(
    family.variants.map(({ id, dimensions }) => [id, dimensions]),
  );

  assert.deepEqual(
    sequence.steps.map(({ changedDimensions }) => changedDimensions),
    [[], ['htmlClass'], ['cssSelector']],
  );
  const [tag, classOnly, active] = sequence.steps.map(({ variantId }) =>
    dimensionsByVariant.get(variantId),
  );
  assert.equal(tag.cssSelector, 'p');
  assert.equal(classOnly.cssSelector, 'p');
  assert.equal(active.cssSelector, '.nedan');
  assert.equal(tag.htmlClass, null);
  assert.equal(classOnly.htmlClass, 'nedan');
  assert.equal(active.htmlClass, 'nedan');
  assert.equal(tag.cssDeclarations, classOnly.cssDeclarations);
  assert.equal(classOnly.cssDeclarations, active.cssDeclarations);
  assert.equal(tag.content, classOnly.content);
  assert.equal(classOnly.content, active.content);
});

test('independent answer-revealing activities require commit-before-reveal semantics', () => {
  const { bundle } = compileLearningSourceV2(loadFixture());
  for (const id of [
    'p-selector-prediction',
    'waku-independent-generation',
    'price-fresh-variation',
  ]) {
    const activity = bundle.activityCatalog.find((item) => item.id === id);
    assert.equal(activity.feedbackGate.revealMode, 'after-commit');
  }
});

test('compiled fixture matches its reviewed golden Bundle contract', () => {
  const { bundle } = compileLearningSourceV2(loadFixture());
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

  assert.deepEqual(bundle, golden);
});

test('compiler rejects invalid source before returning a Bundle', () => {
  const invalid = loadFixture();
  invalid.corePlan[0].activityId = 'missing-activity';

  assert.throws(
    () => compileLearningSourceV2(invalid),
    (error) => {
      assert.ok(error instanceof LearningSourceValidationError);
      assert.deepEqual(
        error.issues.map(({ code }) => code),
        ['UNKNOWN_ACTIVITY'],
      );
      return true;
    },
  );
});

test('valid fixture has no semantic validation issues', () => {
  assert.deepEqual(validateLearningSourceV2(loadFixture()), []);
});

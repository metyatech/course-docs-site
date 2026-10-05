import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileLearningSourceV2 } from '../dist/learning-v2/compiler.js';
import { evaluateResponseV2 } from '../dist/learning-v2/engine/evaluator.js';
import {
  createInitialStaticLearningStateV2,
  reduceStaticLearningStateV2,
} from '../dist/learning-v2/engine/static-state.js';
import { resolveStaticPolicyV2 } from '../dist/learning-v2/engine/static-policy.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(
  packageRoot,
  'tests/fixtures/learning-v2/box-model-class-selector.json',
);

const loadTestBundle = () => {
  const source = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const { bundle } = compileLearningSourceV2(source);
  const mutable = structuredClone(bundle);
  const activity = (id) => mutable.activityCatalog.find((item) => item.id === id);
  const options = [
    { id: 'recommendation', label: '<p>おすすめ</p>' },
    { id: 'title', label: '<h2>チョコドーナツ</h2>' },
    { id: 'description', label: '<p>ふんわり生地にチョコがけ。</p>' },
    { id: 'price', label: '<p>180円</p>' },
  ];
  activity('p-selector-prediction').response = {
    kind: 'selection',
    options,
    correctOptionIds: ['recommendation', 'description', 'price'],
  };
  activity('class-selector-active').response = {
    kind: 'selection',
    options: options.map((option) =>
      option.id === 'price' ? { ...option, label: '<p class="nedan">180円</p>' } : option,
    ),
    correctOptionIds: ['price'],
  };
  activity('waku-independent-generation').response = {
    kind: 'generated-code',
    inputLabel: 'CSSセレクター',
    expectedResponse: '.waku',
  };
  activity('price-fresh-variation').response = {
    kind: 'generated-code',
    inputLabel: 'CSSセレクター',
    expectedResponse: '.price',
  };
  return mutable;
};

test('selection evaluator compares sets independent of order and rejects duplicates', () => {
  const response = {
    kind: 'selection',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    correctOptionIds: ['a', 'b'],
  };
  const evaluator = { id: 'selection-evaluator', kind: 'selection-set' };

  assert.deepEqual(
    evaluateResponseV2(evaluator, response, {
      kind: 'selection',
      selectedOptionIds: ['b', 'a'],
    }),
    { correct: true },
  );
  assert.equal(
    evaluateResponseV2(evaluator, response, {
      kind: 'selection',
      selectedOptionIds: ['a'],
    }).correct,
    false,
  );
  assert.equal(
    evaluateResponseV2(evaluator, response, {
      kind: 'selection',
      selectedOptionIds: ['a', 'b', 'extra'],
    }).correct,
    false,
  );
  assert.equal(
    evaluateResponseV2(evaluator, response, {
      kind: 'selection',
      selectedOptionIds: ['a', 'a', 'b'],
    }).correct,
    false,
  );
});

test('generated-code evaluator trims surrounding whitespace and compares case-sensitively', () => {
  const evaluator = { id: 'exact-evaluator', kind: 'exact-response' };
  const response = {
    kind: 'generated-code',
    inputLabel: 'CSSセレクター',
    expectedResponse: '.waku',
  };

  for (const value of ['.waku', ' .waku '])
    assert.equal(
      evaluateResponseV2(evaluator, response, { kind: 'generated-code', value }).correct,
      true,
    );
  for (const value of ['.WAKU', '.waku div', ''])
    assert.equal(
      evaluateResponseV2(evaluator, response, { kind: 'generated-code', value }).correct,
      false,
    );
});

test('commit reveals only after response, retry records answer exposure lineage', () => {
  const bundle = loadTestBundle();
  let state = createInitialStaticLearningStateV2(bundle);
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'advance',
  });
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'toggle-selection',
    activityId: 'p-selector-prediction',
    optionId: 'recommendation',
  });
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'toggle-selection',
    activityId: 'p-selector-prediction',
    optionId: 'description',
  });
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'toggle-selection',
    activityId: 'p-selector-prediction',
    optionId: 'price',
  });

  assert.equal(resolveStaticPolicyV2(bundle, state).canAdvance, false);
  assert.equal(resolveStaticPolicyV2(bundle, state).isRevealed, false);
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'commit-response',
    activityId: 'p-selector-prediction',
  });
  assert.equal(state.activityStates['p-selector-prediction'].attempts[0].correct, true);
  assert.equal(
    state.activityStates['p-selector-prediction'].attempts[0].answerExposedBeforeAttempt,
    false,
  );
  assert.equal(state.activityStates['p-selector-prediction'].answerExposed, true);
  assert.equal(resolveStaticPolicyV2(bundle, state).canAdvance, true);
  assert.equal(resolveStaticPolicyV2(bundle, state).isRevealed, true);

  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'retry-response',
    activityId: 'p-selector-prediction',
  });
  assert.deepEqual(state.activityStates['p-selector-prediction'].draft, {
    kind: 'selection',
    selectedOptionIds: [],
  });
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'toggle-selection',
    activityId: 'p-selector-prediction',
    optionId: 'recommendation',
  });
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'commit-response',
    activityId: 'p-selector-prediction',
  });
  assert.equal(
    state.activityStates['p-selector-prediction'].attempts[1].answerExposedBeforeAttempt,
    true,
  );
});

test('static policy follows the fixed plan; completion, errors, and final advance do not branch', () => {
  const bundle = loadTestBundle();
  let state = createInitialStaticLearningStateV2(bundle);
  assert.equal(state.currentCoreStepIndex, 0);
  assert.equal(resolveStaticPolicyV2(bundle, state).currentActivity.id, 'minimal-orientation');
  assert.equal(resolveStaticPolicyV2(bundle, state).canAdvance, true);

  const beforeFutureMutation = state;
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'set-generated-code',
    activityId: 'waku-independent-generation',
    value: '.waku',
  });
  assert.equal(state, beforeFutureMutation);

  state = reduceStaticLearningStateV2(bundle, state, { type: 'advance' });
  assert.equal(state.currentCoreStepIndex, 1);
  assert.equal(resolveStaticPolicyV2(bundle, state).currentActivity.id, 'p-selector-prediction');
  assert.equal(resolveStaticPolicyV2(bundle, state).canAdvance, false);
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'commit-response',
    activityId: 'p-selector-prediction',
  });
  assert.equal(state.currentCoreStepIndex, 1, 'an empty answer cannot commit');
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'toggle-selection',
    activityId: 'p-selector-prediction',
    optionId: 'title',
  });
  state = reduceStaticLearningStateV2(bundle, state, {
    type: 'commit-response',
    activityId: 'p-selector-prediction',
  });
  state = reduceStaticLearningStateV2(bundle, state, { type: 'advance' });
  assert.equal(
    resolveStaticPolicyV2(bundle, state).currentActivity.id,
    'concrete-result-reasoning',
  );
  state = reduceStaticLearningStateV2(bundle, state, { type: 'advance' });
  assert.equal(resolveStaticPolicyV2(bundle, state).currentActivity.id, 'class-added-only');

  while (!resolveStaticPolicyV2(bundle, state).isFinal) {
    const context = resolveStaticPolicyV2(bundle, state);
    if (context.currentActivity.response) {
      if (context.currentActivity.response.kind === 'selection') {
        for (const option of context.currentActivity.response.correctOptionIds)
          state = reduceStaticLearningStateV2(bundle, state, {
            type: 'toggle-selection',
            activityId: context.currentActivity.id,
            optionId: option,
          });
      } else {
        state = reduceStaticLearningStateV2(bundle, state, {
          type: 'set-generated-code',
          activityId: context.currentActivity.id,
          value: 'deliberately wrong',
        });
      }
      state = reduceStaticLearningStateV2(bundle, state, {
        type: 'commit-response',
        activityId: context.currentActivity.id,
      });
    }
    state = reduceStaticLearningStateV2(bundle, state, { type: 'advance' });
  }
  assert.equal(state.currentCoreStepIndex, bundle.corePlan.length - 1);
  assert.equal(resolveStaticPolicyV2(bundle, state).isFinal, true);
  const finalState = reduceStaticLearningStateV2(bundle, state, { type: 'advance' });
  assert.equal(finalState.currentCoreStepIndex, state.currentCoreStepIndex);
  assert.equal(
    createInitialStaticLearningStateV2(bundle).currentCoreStepIndex,
    0,
    'a new state starts from the beginning after reload',
  );
});

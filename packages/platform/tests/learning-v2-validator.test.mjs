import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateLearningSourceV2 } from '../dist/learning-v2/validation.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(
  packageRoot,
  'tests/fixtures/learning-v2/box-model-class-selector.json',
);
const loadFixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const expectIssue = (mutate, code, path) => {
  const source = loadFixture();
  mutate(source);
  const issues = validateLearningSourceV2(source);
  assert.ok(
    issues.some((issue) => issue.code === code && issue.path === path),
    JSON.stringify(issues),
  );
};

test('unknown Unit to Knowledge Component references report a deterministic issue', () => {
  const source = loadFixture();
  source.units[0].knowledgeComponentIds[0] = 'missing-kc';

  assert.deepEqual(
    validateLearningSourceV2(source).map(({ code }) => code),
    ['UNKNOWN_KNOWLEDGE_COMPONENT'],
  );
});

test('unknown references are rejected at every declared relationship boundary', () => {
  expectIssue(
    (source) => {
      source.knowledgeComponents[1].prerequisites = ['missing-kc'];
    },
    'UNKNOWN_KNOWLEDGE_COMPONENT',
    'knowledgeComponents[1].prerequisites[0]',
  );
  expectIssue(
    (source) => {
      source.evidenceSpecs[0].targetKnowledgeComponentId = 'missing-kc';
    },
    'UNKNOWN_KNOWLEDGE_COMPONENT',
    'evidenceSpecs[0].targetKnowledgeComponentId',
  );
  expectIssue(
    (source) => {
      source.taskFamilies[0].targetKnowledgeComponentIds = ['missing-kc'];
    },
    'UNKNOWN_KNOWLEDGE_COMPONENT',
    'taskFamilies[0].targetKnowledgeComponentIds[0]',
  );
  expectIssue(
    (source) => {
      source.taskFamilies[0].canProduceEvidenceIds = ['missing-evidence'];
    },
    'UNKNOWN_EVIDENCE_SPEC',
    'taskFamilies[0].canProduceEvidenceIds[0]',
  );
  expectIssue(
    (source) => {
      source.taskFamilies[0].evaluatorId = 'missing-evaluator';
    },
    'UNKNOWN_EVALUATOR',
    'taskFamilies[0].evaluatorId',
  );
  expectIssue(
    (source) => {
      source.taskFamilies[0].linkedContrastSequences[0].steps[0].variantId = 'missing-variant';
    },
    'UNKNOWN_TASK_VARIANT',
    'taskFamilies[0].linkedContrastSequences[0].steps[0].variantId',
  );
  expectIssue(
    (source) => {
      source.activities[1].taskFamilyId = 'missing-family';
    },
    'UNKNOWN_TASK_FAMILY',
    'activities[1].taskFamilyId',
  );
  expectIssue(
    (source) => {
      source.activities[1].taskVariantId = 'waku';
    },
    'TASK_VARIANT_FAMILY_MISMATCH',
    'activities[1].taskVariantId',
  );
  expectIssue(
    (source) => {
      source.activities[1].taskVariantId = 'missing-variant';
    },
    'UNKNOWN_TASK_VARIANT',
    'activities[1].taskVariantId',
  );
  expectIssue(
    (source) => {
      source.activities[1].evidenceSpecIds = ['missing-evidence'];
    },
    'UNKNOWN_EVIDENCE_SPEC',
    'activities[1].evidenceSpecIds[0]',
  );
  expectIssue(
    (source) => {
      source.activities[3].content[3].resourceId = 'missing-resource';
    },
    'UNKNOWN_RESOURCE',
    'activities[3].content[3].resourceId',
  );
  expectIssue(
    (source) => {
      source.activities[1].revealContent[0].resourceId = 'missing-resource';
    },
    'UNKNOWN_RESOURCE',
    'activities[1].revealContent[0].resourceId',
  );
  expectIssue(
    (source) => {
      source.corePlan[0].activityId = 'missing-activity';
    },
    'UNKNOWN_ACTIVITY',
    'corePlan[0].activityId',
  );
});

test('duplicate IDs are rejected', () => {
  expectIssue(
    (source) => {
      source.units.push({ ...source.units[0] });
    },
    'DUPLICATE_ID',
    'units[1].id',
  );
});

test('variable-response Knowledge Components cannot use recognition-only Evidence', () => {
  const source = loadFixture();
  source.knowledgeComponents[0].response.variability = 'variable';
  for (const evidence of source.evidenceSpecs) {
    if (evidence.targetKnowledgeComponentId === 'css-class-selector-match') {
      evidence.observable.response = 'recognition';
    }
  }

  assert.deepEqual(
    validateLearningSourceV2(source).map(({ code }) => code),
    [
      'ACTIVITY_EVIDENCE_RESPONSE_MISMATCH',
      'VARIABLE_RESPONSE_RECOGNITION_ONLY_EVIDENCE',
      'TASK_FAMILY_EVIDENCE_RESPONSE_MISMATCH',
    ],
  );
});

test('fresh independent Evidence cannot expose feedback immediately', () => {
  expectIssue(
    (source) => {
      source.activities[1].feedbackGate.revealMode = 'immediate';
    },
    'FRESH_EVIDENCE_REVEALED_IMMEDIATELY',
    'activities[1].feedbackGate.revealMode',
  );
});

test('linked contrast rejects declared invariants that change across the sequence', () => {
  expectIssue(
    (source) => {
      source.taskFamilies[0].linkedContrastSequences[0].invariantDimensions.push('htmlClass');
    },
    'LINKED_CONTRAST_INVARIANT_CHANGED',
    'taskFamilies[0].linkedContrastSequences[0].invariantDimensions[2]',
  );
});

test('linked contrast changedDimensions must exactly match adjacent variant value differences', () => {
  expectIssue(
    (source) => {
      source.taskFamilies[0].linkedContrastSequences[0].steps[1].changedDimensions = [
        'cssSelector',
      ];
    },
    'LINKED_CONTRAST_CHANGED_DIMENSIONS_MISMATCH',
    'taskFamilies[0].linkedContrastSequences[0].steps[1].changedDimensions',
  );
});

test('variant dimensions must be declared and cannot silently change between contrast steps', () => {
  expectIssue(
    (source) => {
      source.taskFamilies[0].variants[0].dimensions.unmodeled = 'value';
    },
    'UNDECLARED_TASK_DIMENSION',
    'taskFamilies[0].variants[0].dimensions.unmodeled',
  );
});

test('ungraded free-text explanations cannot claim semantic correctness', () => {
  const source = loadFixture();
  source.taskFamilies[1].evaluatorId = 'class-selector-generation-evaluator';
  source.evaluatorSpecs[1].kind = 'not-scored';
  source.evidenceSpecs[2].observable.correctness = 'semantic';
  source.activities[5].response.kind = 'explanation';

  assert.ok(
    validateLearningSourceV2(source).some(
      ({ code, path }) =>
        code === 'UNSCORED_EXPLANATION_SEMANTIC_EVIDENCE' && path === 'activities[5].response.kind',
    ),
  );
});

test('Task Family Evidence targets must be among the family targets', () => {
  expectIssue(
    (source) => {
      source.taskFamilies[0].canProduceEvidenceIds.push('css-class-selector-generate-evidence');
    },
    'TASK_FAMILY_EVIDENCE_TARGET_MISMATCH',
    'taskFamilies[0].canProduceEvidenceIds[2]',
  );
});

test('Activity Evidence must be producible by its Task Family', () => {
  expectIssue(
    (source) => {
      source.activities[1].evidenceSpecIds = ['css-class-selector-generate-evidence'];
    },
    'ACTIVITY_EVIDENCE_NOT_PRODUCIBLE_BY_TASK_FAMILY',
    'activities[1].evidenceSpecIds[0]',
  );
});

test('Activity response must match its Task Family response', () => {
  expectIssue(
    (source) => {
      source.activities[1].response.kind = 'generated-code';
    },
    'ACTIVITY_RESPONSE_KIND_MISMATCH',
    'activities[1].response.kind',
  );
});

test('Task Family response must match every producible Evidence response', () => {
  expectIssue(
    (source) => {
      source.taskFamilies[0].response.kind = 'generated-code';
    },
    'TASK_FAMILY_EVIDENCE_RESPONSE_MISMATCH',
    'taskFamilies[0].canProduceEvidenceIds[0]',
  );
});

test('selection Task Families require the selection-set evaluator', () => {
  const source = loadFixture();
  source.taskFamilies[0].evaluatorId = 'class-selector-generation-evaluator';
  assert.ok(
    validateLearningSourceV2(source).some(
      ({ code, path }) =>
        code === 'TASK_FAMILY_EVALUATOR_RESPONSE_MISMATCH' &&
        path === 'taskFamilies[0].evaluatorId',
    ),
  );
});

test('selection option IDs, correct references, labels, and arrays are validated', () => {
  expectIssue(
    (source) => {
      source.activities[1].response.options[1].id = 'recommendation';
    },
    'DUPLICATE_SELECTION_OPTION_ID',
    'activities[1].response.options[1].id',
  );
  expectIssue(
    (source) => {
      source.activities[1].response.correctOptionIds[1] = 'missing-option';
    },
    'UNKNOWN_SELECTION_OPTION',
    'activities[1].response.correctOptionIds[1]',
  );
  expectIssue(
    (source) => {
      source.activities[1].response.correctOptionIds[1] = 'recommendation';
    },
    'DUPLICATE_CORRECT_OPTION_ID',
    'activities[1].response.correctOptionIds[1]',
  );
  expectIssue(
    (source) => {
      source.activities[1].response.options[2].label = '  ';
    },
    'REQUIRED_STRING',
    'activities[1].response.options[2].label',
  );
  expectIssue(
    (source) => {
      source.activities[1].response.options = 'not-an-array';
    },
    'REQUIRED_ARRAY',
    'activities[1].response.options',
  );
});

test('generated-code response requires nonempty input and expected response', () => {
  expectIssue(
    (source) => {
      source.activities[5].response.inputLabel = ' ';
    },
    'REQUIRED_STRING',
    'activities[5].response.inputLabel',
  );
  expectIssue(
    (source) => {
      source.activities[5].response.expectedResponse = '';
    },
    'REQUIRED_STRING',
    'activities[5].response.expectedResponse',
  );
});

test('renderer resource payloads must match their declared resource kind', () => {
  expectIssue(
    (source) => {
      source.resources[0].payload.css = null;
    },
    'INVALID_RESOURCE_PAYLOAD',
    'resources[0].payload.css',
  );
  expectIssue(
    (source) => {
      source.resources[0].payload = 'not-an-object';
    },
    'INVALID_RESOURCE_PAYLOAD',
    'resources[0].payload',
  );
  expectIssue(
    (source) => {
      source.resources[0].kind = 'static-text';
    },
    'INVALID_RESOURCE_PAYLOAD',
    'resources[0].payload',
  );
});

test('Activity response must match every attached Evidence response', () => {
  expectIssue(
    (source) => {
      source.activities[1].response.kind = 'generated-code';
    },
    'ACTIVITY_EVIDENCE_RESPONSE_MISMATCH',
    'activities[1].evidenceSpecIds[0]',
  );
});

test('Activities with Evidence require a learner response', () => {
  expectIssue(
    (source) => {
      delete source.activities[1].response;
    },
    'ACTIVITY_EVIDENCE_WITHOUT_RESPONSE',
    'activities[1].evidenceSpecIds',
  );
});

test('structural errors cover versions, required values, malformed stable IDs, and non-JSON data', () => {
  expectIssue(
    (source) => {
      source.sourceSchemaVersion = 2;
    },
    'UNSUPPORTED_SOURCE_SCHEMA_VERSION',
    'sourceSchemaVersion',
  );
  expectIssue(
    (source) => {
      source.activities[0].id = 'Bad ID';
    },
    'INVALID_STABLE_ID',
    'activities[0].id',
  );
  expectIssue(
    (source) => {
      source.contentRevision = '  ';
    },
    'EMPTY_CONTENT_REVISION',
    'contentRevision',
  );
  expectIssue(
    (source) => {
      source.courseId = '';
    },
    'EMPTY_COURSE_ID',
    'courseId',
  );
  expectIssue(
    (source) => {
      source.evidenceSpecs[0].supports.dimension = 'confidence';
    },
    'INVALID_ENUM',
    'evidenceSpecs[0].supports.dimension',
  );
  expectIssue(
    (source) => {
      delete source.resources;
    },
    'REQUIRED_ARRAY',
    'resources',
  );
  expectIssue(
    (source) => {
      delete source.activities[0].revealContent;
    },
    'REQUIRED_ARRAY',
    'activities[0].revealContent',
  );
  expectIssue(
    (source) => {
      source.resources[0].payload = Number.NaN;
    },
    'NON_JSON_VALUE',
    'resources[0].payload',
  );
});

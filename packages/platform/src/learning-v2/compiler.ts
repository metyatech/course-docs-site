import { createBundleId, serializeCanonicalJson } from './canonical.js';
import type {
  CompileResult,
  LearningBundleV2,
  LearningSourceV2,
  ValidationIssue,
} from './schema.js';
import { validateLearningSourceV2 } from './validation.js';

export const COMPILER_VERSION = '0.1.0';

export class LearningSourceValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(`LearningSourceV2 validation failed with ${issues.length} error(s).`);
    this.name = 'LearningSourceValidationError';
    this.issues = issues;
  }
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const compileLearningSourceV2 = (input: LearningSourceV2): CompileResult => {
  const issues = validateLearningSourceV2(input);
  if (issues.length > 0) throw new LearningSourceValidationError(issues);

  const source = cloneJson(input);
  const bundleWithoutId = {
    schemaVersion: 1 as const,
    compilerVersion: COMPILER_VERSION,
    courseId: source.courseId,
    contentRevision: source.contentRevision,
    knowledge: {
      units: source.units,
      knowledgeComponents: source.knowledgeComponents,
    },
    evidenceSpecs: source.evidenceSpecs,
    taskFamilies: source.taskFamilies,
    activityCatalog: source.activities,
    corePlan: source.corePlan,
    evaluatorSpecs: source.evaluatorSpecs,
    resourceManifest: source.resources,
  };
  const canonicalJson = serializeCanonicalJson(bundleWithoutId);
  const bundle: LearningBundleV2 = deepFreeze({
    ...bundleWithoutId,
    bundleId: createBundleId(canonicalJson),
  });

  return { bundle, canonicalJson };
};

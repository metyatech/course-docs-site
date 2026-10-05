export type StableId = string;

export interface LearningSourceV2 {
  sourceSchemaVersion: 1;
  courseId: StableId;
  contentRevision: string;
  units: UnitSourceV2[];
  knowledgeComponents: KnowledgeComponentSourceV2[];
  evidenceSpecs: EvidenceSpecSourceV2[];
  taskFamilies: TaskFamilySourceV2[];
  activities: ActivitySourceV2[];
  corePlan: CoreStepSourceV2[];
  evaluatorSpecs: EvaluatorSpecSourceV2[];
  resources: ResourceSourceV2[];
}

export interface UnitSourceV2 {
  id: StableId;
  title: string;
  goal: string;
  knowledgeComponentIds: StableId[];
}

export interface KnowledgeComponentSourceV2 {
  id: StableId;
  claim: { learnerCan: string };
  condition: { variability: 'constant' | 'variable'; relevantFeatures: string[] };
  response: {
    variability: 'constant' | 'variable';
    form: 'recognition' | 'selection' | 'code' | 'execution' | 'explanation' | 'diagnosis';
  };
  forms: {
    performance: 'required' | 'optional' | 'not-required';
    verbal: 'required' | 'optional' | 'not-required';
  };
  rationale: { available: boolean; required: boolean };
  prerequisites: StableId[];
}

export type EvidenceDimension =
  | 'independent-performance'
  | 'assistance-dependence'
  | 'retention'
  | 'generalization'
  | 'calibration';

export type ResponseKind =
  | 'recognition'
  | 'selection'
  | 'generated-code'
  | 'execution'
  | 'explanation'
  | 'diagnosis';

export interface EvidenceSpecSourceV2 {
  id: StableId;
  targetKnowledgeComponentId: StableId;
  observable: {
    response: ResponseKind;
    correctness: 'exact' | 'semantic' | 'behavioral' | 'human-review' | 'not-scored';
  };
  supports: { dimension: EvidenceDimension };
  requires: { assistance: 'none' | 'allowed'; freshBeforeAnswerExposure: boolean };
}

export type TaskDimensionRole = 'relevant' | 'surface' | 'variation' | 'contrast';

export interface TaskDimensionSourceV2 {
  role: TaskDimensionRole;
}

export interface TaskVariantSourceV2 {
  id: StableId;
  dimensions: Record<string, string | number | boolean | null>;
}

export interface LinkedContrastStepSourceV2 {
  variantId: StableId;
  changedDimensions: string[];
}

export interface LinkedContrastSequenceSourceV2 {
  id: StableId;
  invariantDimensions: string[];
  steps: LinkedContrastStepSourceV2[];
}

export interface TaskFamilySourceV2 {
  id: StableId;
  targetKnowledgeComponentIds: StableId[];
  dimensions: Record<string, TaskDimensionSourceV2>;
  response: { kind: ResponseKind };
  evaluatorId: StableId;
  canProduceEvidenceIds: StableId[];
  variants: TaskVariantSourceV2[];
  linkedContrastSequences: LinkedContrastSequenceSourceV2[];
}

export type RevealMode = 'immediate' | 'after-commit';

export interface SelectionOptionV2 {
  readonly id: StableId;
  readonly label: string;
}

export type ActivityResponseSourceV2 =
  | {
      readonly kind: 'selection';
      readonly options: readonly SelectionOptionV2[];
      readonly correctOptionIds: readonly StableId[];
    }
  | {
      readonly kind: 'generated-code';
      readonly inputLabel: string;
      readonly expectedResponse: string;
    }
  | {
      readonly kind: 'recognition' | 'execution' | 'explanation' | 'diagnosis';
    };

export interface ActivitySourceV2 {
  id: StableId;
  taskFamilyId?: StableId;
  taskVariantId?: StableId;
  evidenceSpecIds: StableId[];
  /** Before-commit/common prompt content. */
  content: LearningContentNodeV2[];
  /**
   * Content revealed according to feedbackGate. For after-commit activities this is not visible
   * before commitment.
   */
  revealContent: LearningContentNodeV2[];
  response?: ActivityResponseSourceV2;
  feedbackGate: { revealMode: RevealMode };
}

export type LearningContentNodeV2 =
  | { kind: 'text'; text: string }
  | { kind: 'code'; language: 'html' | 'css' | 'text'; code: string }
  | { kind: 'resource'; resourceId: StableId };

export interface CoreStepSourceV2 {
  id: StableId;
  activityId: StableId;
  blocking: boolean;
}

export interface EvaluatorSpecSourceV2 {
  id: StableId;
  kind: 'exact-response' | 'css-selector' | 'selection-set' | 'not-scored';
}

export interface RenderedHtmlCssResourceSourceV2 {
  id: StableId;
  kind: 'rendered-html-css';
  payload: { html: string; css: string };
}

export interface StaticTextResourceSourceV2 {
  id: StableId;
  kind: 'static-text';
  payload: string;
}

export type ResourceSourceV2 = RenderedHtmlCssResourceSourceV2 | StaticTextResourceSourceV2;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export interface LearningBundleV2 {
  readonly schemaVersion: 1;
  readonly compilerVersion: string;
  readonly courseId: StableId;
  readonly contentRevision: string;
  readonly bundleId: string;
  readonly knowledge: {
    readonly units: readonly DeepReadonly<UnitSourceV2>[];
    readonly knowledgeComponents: readonly DeepReadonly<KnowledgeComponentSourceV2>[];
  };
  readonly evidenceSpecs: readonly DeepReadonly<EvidenceSpecSourceV2>[];
  readonly taskFamilies: readonly DeepReadonly<TaskFamilySourceV2>[];
  readonly activityCatalog: readonly DeepReadonly<ActivitySourceV2>[];
  readonly corePlan: readonly DeepReadonly<CoreStepSourceV2>[];
  readonly evaluatorSpecs: readonly DeepReadonly<EvaluatorSpecSourceV2>[];
  readonly resourceManifest: readonly DeepReadonly<ResourceSourceV2>[];
}

export interface ValidationIssue {
  readonly severity: 'error';
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface CompileResult {
  readonly bundle: LearningBundleV2;
  readonly canonicalJson: string;
}

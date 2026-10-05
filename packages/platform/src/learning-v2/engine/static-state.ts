import type { LearningBundleV2, StableId } from '../schema.js';
import { evaluateResponseV2, type RuntimeResponseV2 } from './evaluator.js';

export interface StaticAttemptV2 {
  readonly response: RuntimeResponseV2;
  readonly correct: boolean;
  readonly answerExposedBeforeAttempt: boolean;
}

export interface StaticActivityStateV2 {
  readonly draft: RuntimeResponseV2 | null;
  readonly attempts: readonly StaticAttemptV2[];
  readonly committed: boolean;
  readonly answerExposed: boolean;
}

export interface StaticLearningStateV2 {
  readonly currentCoreStepIndex: number;
  readonly activityStates: Readonly<Record<StableId, StaticActivityStateV2>>;
}

export type StaticLearningActionV2 =
  | { type: 'toggle-selection'; activityId: StableId; optionId: StableId }
  | { type: 'set-generated-code'; activityId: StableId; value: string }
  | { type: 'commit-response'; activityId: StableId }
  | { type: 'retry-response'; activityId: StableId }
  | { type: 'advance' };

const createDraft = (
  activity: LearningBundleV2['activityCatalog'][number],
): RuntimeResponseV2 | null => {
  if (activity.response?.kind === 'selection') return { kind: 'selection', selectedOptionIds: [] };
  if (activity.response?.kind === 'generated-code') return { kind: 'generated-code', value: '' };
  return null;
};

export const createInitialStaticLearningStateV2 = (
  bundle: LearningBundleV2,
): StaticLearningStateV2 => ({
  currentCoreStepIndex: 0,
  activityStates: Object.fromEntries(
    bundle.activityCatalog.map((activity) => [
      activity.id,
      { draft: createDraft(activity), attempts: [], committed: false, answerExposed: false },
    ]),
  ),
});

const getCurrentActivity = (bundle: LearningBundleV2, state: StaticLearningStateV2) => {
  const step = bundle.corePlan[state.currentCoreStepIndex];
  return step
    ? bundle.activityCatalog.find((activity) => activity.id === step.activityId)
    : undefined;
};

const replaceActivityState = (
  state: StaticLearningStateV2,
  activityId: StableId,
  activityState: StaticActivityStateV2,
): StaticLearningStateV2 => ({
  ...state,
  activityStates: { ...state.activityStates, [activityId]: activityState },
});

export const reduceStaticLearningStateV2 = (
  bundle: LearningBundleV2,
  state: StaticLearningStateV2,
  action: StaticLearningActionV2,
): StaticLearningStateV2 => {
  if (action.type === 'advance') {
    const current = getCurrentActivity(bundle, state);
    if (!current || (current.response && !state.activityStates[current.id]?.committed))
      return state;
    if (state.currentCoreStepIndex >= bundle.corePlan.length - 1) return state;
    return { ...state, currentCoreStepIndex: state.currentCoreStepIndex + 1 };
  }

  const current = getCurrentActivity(bundle, state);
  if (!current || current.id !== action.activityId) return state;
  const currentState = state.activityStates[current.id];
  if (!currentState) return state;

  if (action.type === 'toggle-selection') {
    if (currentState.committed || current.response?.kind !== 'selection') return state;
    if (!current.response.options.some((option) => option.id === action.optionId)) return state;
    const draft = currentState.draft;
    if (!draft || draft.kind !== 'selection') return state;
    const selected = new Set(draft.selectedOptionIds);
    if (selected.has(action.optionId)) selected.delete(action.optionId);
    else selected.add(action.optionId);
    return replaceActivityState(state, current.id, {
      ...currentState,
      draft: { kind: 'selection', selectedOptionIds: [...selected] },
    });
  }

  if (action.type === 'set-generated-code') {
    if (currentState.committed || current.response?.kind !== 'generated-code') return state;
    if (!currentState.draft || currentState.draft.kind !== 'generated-code') return state;
    return replaceActivityState(state, current.id, {
      ...currentState,
      draft: { kind: 'generated-code', value: action.value },
    });
  }

  if (action.type === 'commit-response') {
    if (
      current.id !== action.activityId ||
      currentState.committed ||
      !current.response ||
      !currentState.draft
    )
      return state;
    const response = currentState.draft;
    const hasResponse =
      response.kind === 'selection'
        ? response.selectedOptionIds.length > 0
        : response.value.trim().length > 0;
    if (!hasResponse) return state;
    const family = bundle.taskFamilies.find((item) => item.id === current.taskFamilyId);
    const evaluator = bundle.evaluatorSpecs.find((item) => item.id === family?.evaluatorId);
    if (!evaluator) return state;
    const result = evaluateResponseV2(evaluator, current.response, response);
    const attempt: StaticAttemptV2 = {
      response,
      correct: result.correct,
      answerExposedBeforeAttempt: currentState.answerExposed,
    };
    return replaceActivityState(state, current.id, {
      ...currentState,
      attempts: [...currentState.attempts, attempt],
      committed: true,
      answerExposed: true,
    });
  }

  if (action.type === 'retry-response') {
    if (!currentState.committed || !currentState.attempts.length) return state;
    return replaceActivityState(state, current.id, {
      ...currentState,
      draft: createDraft(current),
      committed: false,
    });
  }

  return state;
};

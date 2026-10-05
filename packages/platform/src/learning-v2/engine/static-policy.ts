import type { LearningBundleV2 } from '../schema.js';
import type { StaticLearningStateV2 } from './static-state.js';

export interface StaticPolicyResolutionV2 {
  readonly currentCoreStep: LearningBundleV2['corePlan'][number];
  readonly currentActivity: LearningBundleV2['activityCatalog'][number];
  readonly canAdvance: boolean;
  readonly isRevealed: boolean;
  readonly isFinal: boolean;
}

export const resolveStaticPolicyV2 = (
  bundle: LearningBundleV2,
  state: StaticLearningStateV2,
): StaticPolicyResolutionV2 | undefined => {
  const currentCoreStep = bundle.corePlan[state.currentCoreStepIndex];
  if (!currentCoreStep) return undefined;
  const currentActivity = bundle.activityCatalog.find(
    (activity) => activity.id === currentCoreStep.activityId,
  );
  if (!currentActivity) return undefined;
  const activityState = state.activityStates[currentActivity.id];
  const hasResponse = currentActivity.response !== undefined;
  const canAdvance = !hasResponse || activityState?.committed === true;

  return {
    currentCoreStep,
    currentActivity,
    canAdvance,
    isRevealed:
      currentActivity.feedbackGate.revealMode === 'immediate' ||
      activityState?.answerExposed === true,
    isFinal: state.currentCoreStepIndex === bundle.corePlan.length - 1,
  };
};

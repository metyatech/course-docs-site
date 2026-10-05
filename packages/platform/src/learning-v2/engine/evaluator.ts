import type { ActivityResponseSourceV2, EvaluatorSpecSourceV2, StableId } from '../schema.js';

export type RuntimeResponseV2 =
  | { kind: 'selection'; selectedOptionIds: readonly StableId[] }
  | { kind: 'generated-code'; value: string };

export interface EvaluationResultV2 {
  readonly correct: boolean;
}

export const evaluateResponseV2 = (
  evaluator: EvaluatorSpecSourceV2,
  specification: ActivityResponseSourceV2,
  response: RuntimeResponseV2,
): EvaluationResultV2 => {
  if (
    evaluator.kind === 'selection-set' &&
    specification.kind === 'selection' &&
    response.kind === 'selection'
  ) {
    const selected = new Set(response.selectedOptionIds);
    const correct = new Set(specification.correctOptionIds);
    return {
      correct:
        selected.size === response.selectedOptionIds.length &&
        selected.size === correct.size &&
        [...selected].every((optionId) => correct.has(optionId)),
    };
  }

  if (
    evaluator.kind === 'exact-response' &&
    specification.kind === 'generated-code' &&
    response.kind === 'generated-code'
  )
    return {
      correct:
        response.value.trim().length > 0 &&
        response.value.trim() === specification.expectedResponse.trim(),
    };

  return { correct: false };
};

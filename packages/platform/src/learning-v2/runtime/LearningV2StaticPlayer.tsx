'use client';

import { useState } from 'react';
import type { LearningBundleV2, StableId } from '../schema.js';
import type { RuntimeResponseV2 } from '../engine/evaluator.js';
import { resolveStaticPolicyV2 } from '../engine/static-policy.js';
import {
  createInitialStaticLearningStateV2,
  reduceStaticLearningStateV2,
  type StaticLearningActionV2,
} from '../engine/static-state.js';
import { LearningContentRenderer } from './content-renderer.js';

export interface LearningV2StaticPlayerProps {
  readonly bundle: LearningBundleV2;
}

const isSelected = (response: RuntimeResponseV2 | null, optionId: StableId) =>
  response?.kind === 'selection' && response.selectedOptionIds.includes(optionId);

export function LearningV2StaticPlayer({ bundle }: LearningV2StaticPlayerProps) {
  const [state, setState] = useState(() => createInitialStaticLearningStateV2(bundle));
  const dispatch = (action: StaticLearningActionV2) =>
    setState((current) => reduceStaticLearningStateV2(bundle, current, action));
  const current = resolveStaticPolicyV2(bundle, state);
  if (!current) return null;

  const currentIndex = state.currentCoreStepIndex;
  return (
    <main className="learning-v2" aria-label="CSSの学習">
      {bundle.corePlan.slice(0, currentIndex + 1).map((step, index) => {
        const activity = bundle.activityCatalog.find(({ id }) => id === step.activityId);
        if (!activity) return null;
        const activityState = state.activityStates[activity.id];
        const isCurrent = index === currentIndex;
        const committedResponse = activityState?.attempts.at(-1)?.response ?? null;
        const responseValue = activityState?.committed
          ? committedResponse
          : (activityState?.draft ?? null);
        const selectedAnswer = activityState?.committed ? activityState.attempts.at(-1) : undefined;
        const isRevealed =
          activity.feedbackGate.revealMode === 'immediate' || activityState?.answerExposed === true;

        return (
          <section className="learning-v2__activity" key={step.id} data-activity-id={activity.id}>
            <LearningContentRenderer bundle={bundle} nodes={activity.content} />
            {isRevealed && activity.revealContent.length > 0 ? (
              <LearningContentRenderer bundle={bundle} nodes={activity.revealContent} />
            ) : null}
            {activity.response?.kind === 'selection' ? (
              <fieldset
                className="learning-v2__response"
                disabled={!isCurrent || activityState?.committed === true}
              >
                <legend>選択肢</legend>
                {activity.response.options.map((option) => (
                  <label className="learning-v2__option" key={option.id}>
                    <input
                      type="checkbox"
                      checked={isSelected(responseValue, option.id)}
                      onChange={() =>
                        dispatch({
                          type: 'toggle-selection',
                          activityId: activity.id,
                          optionId: option.id,
                        })
                      }
                    />
                    <code>{option.label}</code>
                  </label>
                ))}
              </fieldset>
            ) : activity.response?.kind === 'generated-code' ? (
              <div className="learning-v2__response">
                <label className="learning-v2__input-label" htmlFor={`response-${activity.id}`}>
                  {activity.response.inputLabel}
                </label>
                <input
                  id={`response-${activity.id}`}
                  type="text"
                  value={responseValue?.kind === 'generated-code' ? responseValue.value : ''}
                  readOnly={!isCurrent || activityState?.committed === true}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  onChange={(event) =>
                    dispatch({
                      type: 'set-generated-code',
                      activityId: activity.id,
                      value: event.currentTarget.value,
                    })
                  }
                />
              </div>
            ) : null}
            {isCurrent && activity.response ? (
              activityState?.committed ? (
                <>
                  <p className="learning-v2__result" aria-live="polite">
                    {selectedAnswer?.correct ? '正解' : '違いを確認'}
                  </p>
                  <div className="learning-v2__actions">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'retry-response', activityId: activity.id })}
                    >
                      もう一度
                    </button>
                    {current.canAdvance && !current.isFinal ? (
                      <button type="button" onClick={() => dispatch({ type: 'advance' })}>
                        次へ
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <button
                  className="learning-v2__commit"
                  type="button"
                  disabled={
                    !responseValue ||
                    (responseValue.kind === 'selection'
                      ? responseValue.selectedOptionIds.length === 0
                      : responseValue.value.trim().length === 0)
                  }
                  onClick={() => dispatch({ type: 'commit-response', activityId: activity.id })}
                >
                  答えを確認
                </button>
              )
            ) : null}
            {isCurrent && !activity.response && current.canAdvance && !current.isFinal ? (
              <div className="learning-v2__actions">
                <button type="button" onClick={() => dispatch({ type: 'advance' })}>
                  次へ
                </button>
              </div>
            ) : null}
          </section>
        );
      })}
    </main>
  );
}

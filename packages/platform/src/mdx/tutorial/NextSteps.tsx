import type { ReactNode } from 'react';

export type NextStepsProps = {
  children: ReactNode;
};

/**
 * End-of-tutorial guidance listing concrete next actions
 * (other tutorials, documentation pages, exercises).
 *
 * Placed at the end of the final Step or after the last Checkpoint.
 * Each item should link to a concrete next action.
 */
export default function NextSteps({ children }: NextStepsProps) {
  return (
    <div className="tutorial-nextsteps">
      <div className="tutorial-nextsteps__title">次のステップ</div>
      <div className="tutorial-nextsteps__body">{children}</div>
    </div>
  );
}

import type { ReactNode } from 'react';

export type CheckpointProps = {
  children: ReactNode;
};

/**
 * Optional checklist for a meaningful milestone with multiple conditions.
 * Renders as a highlighted box with checkmark items.
 */
export default function Checkpoint({ children }: CheckpointProps) {
  return (
    <div className="tutorial-checkpoint">
      <div className="tutorial-checkpoint__title">確認ポイント</div>
      <div className="tutorial-checkpoint__body">{children}</div>
    </div>
  );
}

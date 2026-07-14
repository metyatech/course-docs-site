import type { ReactNode } from 'react';

export type CheckpointProps = {
  children: ReactNode;
};

/**
 * End-of-Step checklist confirming everything works.
 * Renders as a highlighted box with checkmark items.
 * Exactly one per Step, placed at the end.
 */
export default function Checkpoint({ children }: CheckpointProps) {
  return (
    <div className="tutorial-checkpoint">
      <div className="tutorial-checkpoint__title">確認ポイント</div>
      <div className="tutorial-checkpoint__body">{children}</div>
    </div>
  );
}

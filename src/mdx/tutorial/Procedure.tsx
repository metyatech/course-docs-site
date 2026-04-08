import type { ReactNode } from 'react';

export type ProcedureProps = {
  /** Short reason why this group of actions is needed. */
  why?: string;
  children: ReactNode;
};

/**
 * A group of Actions forming one logical task within a Step.
 * Optionally shows a short "why" sentence before the actions.
 */
export default function Procedure({ why, children }: ProcedureProps) {
  return (
    <div className="tutorial-procedure">
      {why && <p className="tutorial-procedure__why">{why}</p>}
      <ol className="tutorial-procedure__actions">{children}</ol>
    </div>
  );
}

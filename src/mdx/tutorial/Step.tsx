import type { ReactNode } from 'react';

export type StepProps = {
  /** What the learner will have achieved when this Step is complete. */
  goal: string;
  children: ReactNode;
};

/**
 * Top-level milestone in a tutorial.
 * Renders the goal as a highlighted banner, then the children.
 */
export default function Step({ goal, children }: StepProps) {
  return (
    <section className="tutorial-step">
      <div className="tutorial-step__goal">{goal}</div>
      {children}
    </section>
  );
}

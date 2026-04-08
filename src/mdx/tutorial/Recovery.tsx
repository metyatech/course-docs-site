import type { ReactNode } from 'react';

export type RecoveryProps = {
  /**
   * Short label that names the failure case this recovery handles
   * (e.g. "矢印（移動ギズモ）が表示されないとき").
   */
  title: string;
  children: ReactNode;
};

/**
 * Inline recovery / fallback for an Action that can fail.
 *
 * Placed immediately after the Action whose failure mode it addresses.
 * Visually distinct from the main path so learners on the happy path can
 * skip it at a glance, but always visible (not collapsible) so learners
 * who have hit the failure can find the fix without extra interaction.
 */
export default function Recovery({ title, children }: RecoveryProps) {
  return (
    <aside className="tutorial-recovery" role="note">
      <div className="tutorial-recovery__title">
        <span className="tutorial-recovery__icon" aria-hidden="true">
          ⚠
        </span>
        {title}
      </div>
      <div className="tutorial-recovery__body">{children}</div>
    </aside>
  );
}

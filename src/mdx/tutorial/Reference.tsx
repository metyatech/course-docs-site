import type { ReactNode } from 'react';

export type ReferenceProps = {
  /** Label for the collapsible summary. */
  title: string;
  children: ReactNode;
};

/**
 * Reference material (key tables, panel descriptions, etc.).
 * Always rendered as a collapsible <details>, distinct from Concept.
 * Placed near the Procedure where the reference is relevant.
 */
export default function Reference({ title, children }: ReferenceProps) {
  return (
    <details className="tutorial-reference">
      <summary className="tutorial-reference__summary">
        <span className="tutorial-reference__icon" aria-hidden="true">
          📖
        </span>
        {title}
      </summary>
      <div className="tutorial-reference__body">{children}</div>
    </details>
  );
}

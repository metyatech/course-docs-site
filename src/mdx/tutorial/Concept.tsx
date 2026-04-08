import type { ReactNode } from 'react';

export type ConceptProps = {
  /** The term or concept name shown in the summary. */
  title: string;
  children: ReactNode;
};

/**
 * Background knowledge or term definition.
 * Always rendered as a collapsible <details> so it doesn't interrupt the main path.
 * Placed immediately before the Procedure that first uses the concept.
 */
export default function Concept({ title, children }: ConceptProps) {
  return (
    <details className="tutorial-concept">
      <summary className="tutorial-concept__summary">
        <span className="tutorial-concept__icon" aria-hidden="true">
          💡
        </span>
        {title}
      </summary>
      <div className="tutorial-concept__body">{children}</div>
    </details>
  );
}

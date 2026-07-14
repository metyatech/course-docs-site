'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export type ConceptProps = {
  /** The term or concept name shown in the summary. */
  title: string;
  children: ReactNode;
};

const EXPERT_SEARCH_VALUES = new Set(['expert', 'advanced']);

function isExpertMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const level = params.get('level');
    return level ? EXPERT_SEARCH_VALUES.has(level) : false;
  } catch {
    return false;
  }
}

/**
 * Background knowledge or term definition (Pre-training principle).
 * Always rendered as a collapsible <details> so it doesn't interrupt the main path.
 * Placed immediately before the Procedure that first uses the concept.
 *
 * Expertise reversal support: when the page URL carries `?level=expert`
 * (or `?level=advanced`), Concept elements are force-collapsed. This
 * lets advanced readers skim without seeing novice-level Pre-training
 * by default — they can still open individual Concepts when needed.
 */
export default function Concept({ title, children }: ConceptProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    if (isExpertMode()) {
      details.open = false;
    }
  }, []);

  return (
    <details ref={detailsRef} className="tutorial-concept">
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

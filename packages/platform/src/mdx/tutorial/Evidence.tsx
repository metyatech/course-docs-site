import type { ReactNode } from 'react';

export type EvidenceProps = {
  targets: string;
  demonstrates: 'application' | 'retrieval' | 'transfer';
  children: ReactNode;
};

/** Metadata-only binding for an existing learner-facing assessment surface. */
export default function Evidence({ children }: EvidenceProps) {
  return children;
}

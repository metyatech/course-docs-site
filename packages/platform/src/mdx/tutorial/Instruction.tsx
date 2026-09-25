import type { ReactNode } from 'react';

/** Marks the instructional phase for deterministic learning-pattern validation. */
export default function Instruction({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

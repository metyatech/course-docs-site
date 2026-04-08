import type { ReactNode } from 'react';

export type VerifyProps = {
  /** Description of the expected result. */
  children: ReactNode;
};

/**
 * Confirmation that a Procedure succeeded.
 * Renders as a "→ result" line.
 */
export default function Verify({ children }: VerifyProps) {
  return (
    <div className="tutorial-verify">
      <span className="tutorial-verify__arrow" aria-hidden="true">
        →
      </span>
      <span className="tutorial-verify__text">{children}</span>
    </div>
  );
}

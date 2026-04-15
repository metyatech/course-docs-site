import type { ReactNode } from 'react';
import { ImageZoom } from 'nextra/components';

export type VerifyProps = {
  /**
   * Optional screenshot showing the expected result state.
   *
   * Provide this when the expected outcome is primarily visual (e.g. a UI
   * icon changing state, a panel layout, a graph shape). Per the Multimedia
   * and Feedback principles, an observable visual state requires an image to
   * allow the learner to compare the actual screen against the expected state.
   *
   * Place this Verify at the natural Procedure end (i.e. at a state-
   * transition or sub-goal boundary), not after every individual Action.
   */
  img?: string;
  /** Alt text for the result image. Defaults to empty string. */
  alt?: string;
  /** Description of the expected result. */
  children: ReactNode;
};

/**
 * Confirmation that a Procedure succeeded.
 * Renders as a "→ result" line, optionally preceded by a result-state
 * screenshot.
 */
export default function Verify({ img, alt, children }: VerifyProps) {
  return (
    <div className="tutorial-verify">
      {img && (
        <ImageZoom src={img} alt={alt ?? ''} className="tutorial-verify__img" loading="lazy" />
      )}
      <div className="tutorial-verify__body">
        <span className="tutorial-verify__arrow" aria-hidden="true">
          →
        </span>
        <span className="tutorial-verify__text">{children}</span>
      </div>
    </div>
  );
}

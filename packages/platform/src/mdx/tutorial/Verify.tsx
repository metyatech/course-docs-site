import type { ReactNode } from 'react';
import { ImageZoom } from 'nextra/components';

export type VerifyProps = {
  /**
   * Optional image for a visual comparison when it helps confirm the result.
   */
  img?: string;
  /** Alt text for the result image. Defaults to empty string. */
  alt?: string;
  /** Description of the expected result. */
  children: ReactNode;
};

/**
 * Closure for a goal when observable state or behavior is its evidence.
 * Place at a natural goal or sub-goal boundary, not after every Action.
 * An image is optional and useful only when visual comparison helps.
 * Renders as a "→ result" line, optionally preceded by an image.
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

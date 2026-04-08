import type { ReactNode } from 'react';
import { ImageZoom } from 'nextra/components';

export type ActionProps = {
  /** Path to the screenshot showing where to interact. */
  img?: string;
  /** Alt text for the image. */
  alt?: string;
  /** What the learner should do (text instruction). */
  children: ReactNode;
};

/**
 * A single atomic operation: image (where) → instruction (what to do) →
 * optional inline result.
 *
 * Renders as a `<div>` so it can sit anywhere inside a Section, including
 * directly next to other Sections, Concepts, References, or Recoveries.
 * Visual numbering is provided by a CSS counter scoped to the nearest
 * Section, so action numbers reset cleanly per sub-section.
 *
 * Image is always above the text (spatial proximity principle).
 */
export default function Action({ img, alt, children }: ActionProps) {
  return (
    <div className="tutorial-action">
      {img && (
        <ImageZoom src={img} alt={alt ?? ''} className="tutorial-action__img" loading="lazy" />
      )}
      <div className="tutorial-action__text">{children}</div>
    </div>
  );
}

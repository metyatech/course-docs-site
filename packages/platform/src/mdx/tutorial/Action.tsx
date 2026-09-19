import type { ReactNode } from 'react';
import { ImageZoom } from 'nextra/components';

export type ActionProps = {
  /** Optional visual representation of the operation. */
  img?: string;
  /** Alt text for the image. */
  alt?: string;
  /** Instruction, code, CodePreview, or another representation needed for the task. */
  children: ReactNode;
};

/**
 * One atomic learner operation. An image is optional: visual representation
 * is one of several ways to present an operation, and children can provide
 * the instruction, code, CodePreview, or other representation the task needs.
 *
 * When an image is provided, it renders above the text as it does today.
 * Visual numbering is provided by a CSS counter scoped to the nearest
 * Section, so action numbers reset cleanly per sub-section.
 *
 * For numbered callouts on screenshots, use the tutorial-shots editor in
 * course-docs-site (`/dev/tutorial-shots`): it keeps a separate raw
 * image and an annotation JSON and bakes the callouts into the
 * published image at build time, which keeps MDX free of pixel
 * coordinates and keeps annotations re-editable.
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

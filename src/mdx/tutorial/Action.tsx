import type { ReactNode } from 'react';
import { ImageZoom } from 'nextra/components';

export type ActionCallout = {
  /** Horizontal centre of the callout, as a percentage of the image width (0-100). */
  x: number;
  /** Vertical centre of the callout, as a percentage of the image height (0-100). */
  y: number;
  /** Label rendered inside the callout (e.g. "①" or "1"). */
  label: string;
};

export type ActionProps = {
  /** Path to the screenshot showing where to interact. */
  img?: string;
  /** Alt text for the image. */
  alt?: string;
  /**
   * Optional numbered callouts to overlay on the image. Each callout is
   * positioned as a percentage of the image dimensions so the overlay
   * scales with responsive layouts. Use in conjunction with the matching
   * ①②③ numbers in the instruction text (Signaling principle — sequence
   * cues are complementary across image and text).
   */
  callouts?: ActionCallout[];
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
 * Image is always above the text (spatial proximity principle). When
 * `callouts` are supplied, they are overlaid on the image at the given
 * percentage coordinates to support Signaling (visual cueing) without
 * requiring the author to bake numbers into the screenshot.
 */
export default function Action({ img, alt, callouts, children }: ActionProps) {
  const hasCallouts = img && callouts && callouts.length > 0;
  return (
    <div className="tutorial-action">
      {img &&
        (hasCallouts ? (
          <div className="tutorial-action__img-wrapper">
            <ImageZoom src={img} alt={alt ?? ''} className="tutorial-action__img" loading="lazy" />
            <div className="tutorial-action__callouts" aria-hidden="true">
              {callouts.map((callout, index) => (
                <span
                  key={`${callout.label}-${index}`}
                  className="tutorial-action__callout"
                  style={{ left: `${callout.x}%`, top: `${callout.y}%` }}
                >
                  {callout.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <ImageZoom src={img} alt={alt ?? ''} className="tutorial-action__img" loading="lazy" />
        ))}
      <div className="tutorial-action__text">{children}</div>
    </div>
  );
}

import { Children, type ReactNode } from 'react';
import type { LearningEventMetadata } from './learning-model.js';

export type SectionProps = LearningEventMetadata & {
  /**
   * Visible heading text. The actual `<h2>` / `<h3>` / ... element is injected
   * by the `remark-section-headings` plugin at compile time, so it appears in
   * the page TOC and uses Nextra's themed heading component automatically.
   * The `title` is kept here for runtime introspection and future tooling.
   */
  title: string;
  /**
   * Optional learner-facing orientation at any depth. This is neither the
   * canonical Learning Unit objective nor evidence of learning.
   */
  goal?: string;
  /**
   * Nesting depth assigned by the `remark-section-headings` plugin at compile
   * time. Authors do not pass this themselves — the plugin computes it from
   * how many enclosing `<Section>` ancestors the element has and rewrites it
   * onto the JSX node. Defaults to 0 if the plugin did not run for any
   * reason (so the component still renders something coherent).
   */
  depth?: number;
  children: ReactNode;
};

/**
 * Recursive container for tutorial structure. Replaces both `<Step>` and
 * `<Procedure>` with a single component that nests to arbitrary depth.
 *
 * Behavior:
 * - Receives its own depth via the `depth` prop, computed at compile time
 *   by `remark-section-headings`. This keeps Section as a pure server
 *   component with no React Context, no client boundary, and no runtime
 *   ancestor tracking.
 * - Relies on the same plugin to inject a markdown heading as the first
 *   child, so the heading participates in Nextra's TOC and gets themed
 *   anchor links for free.
 * - Renders the optional `goal` banner immediately after the injected
 *   heading and before the rest of the body.
 */
export default function Section({ goal, depth = 0, children }: SectionProps) {
  // The remark plugin injects the markdown heading as the first child.
  // We split it out so we can render: heading -> goal banner -> rest.
  const childArray = Children.toArray(children);
  const [headingChild, ...restChildren] = childArray;

  return (
    <section className="tutorial-section" data-section-depth={depth}>
      {headingChild}
      {goal?.trim() && (
        <div className="tutorial-section__goal" data-section-depth={depth}>
          {goal}
        </div>
      )}
      <div className="tutorial-section__body">{restChildren}</div>
    </section>
  );
}

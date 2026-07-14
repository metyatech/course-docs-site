import { Children, type ReactNode } from 'react';

export type SectionProps = {
  /**
   * Visible heading text. The actual `<h2>` / `<h3>` / ... element is injected
   * by the `remark-section-headings` plugin at compile time, so it appears in
   * the page TOC and uses Nextra's themed heading component automatically.
   * The `title` is kept here for runtime introspection and future tooling.
   */
  title: string;
  /**
   * What the learner will have achieved when this Section is complete.
   *
   * **Required at depth 0** (top-level Sections must declare a goal so the
   * tutorial follows goal-first ordering). Optional at deeper levels, where
   * the title alone is often sufficient.
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
 * - Throws at depth 0 if `goal` is missing, so authors cannot accidentally
 *   ship a top-level Section without a goal statement.
 */
export default function Section({ title, goal, depth = 0, children }: SectionProps) {
  if (depth === 0 && !goal) {
    throw new Error(
      `<Section title="${title}"> is at depth 0 and must have a "goal" prop. ` +
        `Top-level Sections must declare what the learner will have achieved when complete.`,
    );
  }

  // The remark plugin injects the markdown heading as the first child.
  // We split it out so we can render: heading -> goal banner -> rest.
  const childArray = Children.toArray(children);
  const [headingChild, ...restChildren] = childArray;

  return (
    <section className="tutorial-section" data-section-depth={depth}>
      {headingChild}
      {goal && (
        <div className="tutorial-section__goal" data-section-depth={depth}>
          {goal}
        </div>
      )}
      <div className="tutorial-section__body">{restChildren}</div>
    </section>
  );
}

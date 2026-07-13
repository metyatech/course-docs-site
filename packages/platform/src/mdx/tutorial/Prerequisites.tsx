import type { ReactNode } from 'react';

export type PrerequisitesProps = {
  children: ReactNode;
};

/**
 * Page-level prerequisites block listing what the learner needs
 * before starting the tutorial.
 *
 * Placed at the page top, before the first Step/Section.
 * Renders as a highlighted box with a checklist of requirements.
 */
export default function Prerequisites({ children }: PrerequisitesProps) {
  return (
    <div className="tutorial-prerequisites">
      <div className="tutorial-prerequisites__title">前提条件</div>
      <div className="tutorial-prerequisites__body">{children}</div>
    </div>
  );
}

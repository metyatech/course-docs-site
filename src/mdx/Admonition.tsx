import type { ReactNode } from 'react';

export type AdmonitionProps = {
  type: 'tip' | 'info' | 'note' | 'caution' | 'danger' | string;
  title?: string;
  children: ReactNode;
};

const DEFAULT_TITLES: Record<string, string> = {
  tip: 'Tip',
  info: 'Info',
  note: 'Note',
  caution: 'Caution',
  danger: 'Danger',
};

export default function Admonition({ type, title, children }: AdmonitionProps) {
  const resolvedTitle = title ?? DEFAULT_TITLES[type] ?? type;
  const className = `course-admonition course-admonition--${type}`;

  return (
    <div className={className}>
      <div className="course-admonition__title">{resolvedTitle}</div>
      <div className="course-admonition__content">{children}</div>
    </div>
  );
}

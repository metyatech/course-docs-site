import type { ReactNode } from 'react';
import { Callout } from 'nextra/components';
import {
  buildUnsupportedAdmonitionMessage,
  CALLOUT_TYPE_BY_ADMONITION_TYPE,
  type AdmonitionType,
  resolveAdmonitionType,
} from './admonition-types.js';

export type AdmonitionProps = {
  type: AdmonitionType | string;
  title?: string;
  children: ReactNode;
};

export default function Admonition({ type, title, children }: AdmonitionProps) {
  const resolvedType = resolveAdmonitionType(type);
  if (!resolvedType) {
    throw new Error(buildUnsupportedAdmonitionMessage(type));
  }

  const trimmedTitle = title?.trim();
  const content = trimmedTitle ? (
    <div className="course-callout">
      <div className="course-callout__title">{trimmedTitle}</div>
      <div className="course-callout__content">{children}</div>
    </div>
  ) : (
    children
  );

  return <Callout type={CALLOUT_TYPE_BY_ADMONITION_TYPE[resolvedType]}>{content}</Callout>;
}

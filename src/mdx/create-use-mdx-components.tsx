import type { ComponentType, ReactNode } from 'react';
import type { MDXComponents } from 'nextra/mdx-components';
import { CodePreview } from '@metyatech/code-preview/server';
import Exercise, { Answer, Hint, QuickCheck } from '@metyatech/exercise/client';
import { useMDXComponents as getThemeComponents } from 'nextra-theme-docs';
import Admonition from './Admonition.js';
import DownloadLink from './DownloadLink.js';
import {
  Section,
  Action,
  Verify,
  Concept,
  Reference,
  Recovery,
  Checkpoint,
  Prerequisites,
  NextSteps,
} from './tutorial/index.js';

type WrapperProps = {
  toc: unknown;
  metadata: unknown;
  sourceCode: unknown;
  children: ReactNode;
};

type NextraMDXComponents = MDXComponents & {
  wrapper?: ComponentType<WrapperProps>;
};

const baseComponents: MDXComponents = {
  CodePreview,
  Exercise,
  QuickCheck,
  Hint,
  Answer,
  Admonition,
  DownloadLink,
  Section,
  Action,
  Verify,
  Concept,
  Reference,
  Recovery,
  Checkpoint,
  Prerequisites,
  NextSteps,
};

export function createUseMDXComponents(extra: MDXComponents = {}) {
  return function useMDXComponents(components: MDXComponents = {}): NextraMDXComponents {
    return getThemeComponents({
      ...components,
      ...baseComponents,
      ...extra,
    }) as NextraMDXComponents;
  };
}

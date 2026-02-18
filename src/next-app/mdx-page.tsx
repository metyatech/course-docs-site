import type { ComponentType, ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { generateStaticParamsFor, importPage } from 'nextra/pages';
import { createUseMDXComponents } from '../mdx/create-use-mdx-components.js';
import { shouldIgnoreMdxPath } from './should-ignore-mdx-path.js';

type PageProps = {
  params: Promise<{
    mdxPath: string[];
  }>;
};

type WrapperProps = {
  toc: unknown;
  metadata: unknown;
  sourceCode: unknown;
  children: ReactNode;
};

export const generateStaticParams = generateStaticParamsFor('mdxPath');

export async function generateMetadata({ params }: PageProps) {
  const resolvedParams = await params;
  if (shouldIgnoreMdxPath(resolvedParams.mdxPath)) {
    notFound();
  }
  const { metadata } = await importPage(resolvedParams.mdxPath);
  return metadata;
}

const getMDXComponents = createUseMDXComponents();
const Wrapper = getMDXComponents().wrapper as ComponentType<WrapperProps>;

export default async function Page(props: PageProps) {
  const params = await props.params;
  if (shouldIgnoreMdxPath(params.mdxPath)) {
    notFound();
  }
  const { default: MDXContent, toc, metadata, sourceCode } = await importPage(params.mdxPath);

  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}

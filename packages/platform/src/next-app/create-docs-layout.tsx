import type { ReactNode } from 'react';
import { Layout } from 'nextra-theme-docs';
import { getPageMap } from 'nextra/page-map';

export function createDocsLayout(themeConfig: Record<string, unknown>) {
  return async function DocsLayout({ children }: { children: ReactNode }) {
    const pageMap = await getPageMap();

    return (
      <Layout {...themeConfig} pageMap={pageMap}>
        {children}
      </Layout>
    );
  };
}

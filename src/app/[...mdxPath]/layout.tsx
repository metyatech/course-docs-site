import type { ReactNode } from "react";
import { Layout } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import themeConfig from "../../../theme.config";

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const pageMap = await getPageMap();

  return (
    <Layout {...(themeConfig as Record<string, unknown>)} pageMap={pageMap}>
      {children}
    </Layout>
  );
}

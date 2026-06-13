import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Layout } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import themeConfig from "../../../theme.config";
import {
  filterProtectedPageMap,
  getAdminModeCookieName,
  hasProtectedAdminRoutes,
  isAdminSessionValid,
} from "../../lib/admin-mode";

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const pageMap = await getPageMap();

  let visiblePageMap = pageMap;
  if (hasProtectedAdminRoutes()) {
    const cookieStore = await cookies();
    const enabled = await isAdminSessionValid(cookieStore.get(getAdminModeCookieName())?.value);
    if (!enabled) {
      visiblePageMap = filterProtectedPageMap(pageMap);
    }
  }

  return (
    <Layout {...(themeConfig as Record<string, unknown>)} pageMap={visiblePageMap}>
      {children}
    </Layout>
  );
}

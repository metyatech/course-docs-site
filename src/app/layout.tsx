import { createRootLayout } from "@metyatech/course-docs-platform/next-app/create-root-layout";
import DevAutoReload from "../components/dev-auto-reload";
import { getSiteDescription, getSiteFaviconHref } from "../lib/site-config";
import "./accessibility-overrides.css";
import "./navigation-accessibility-overrides.css";

const BaseRootLayout = createRootLayout({
  description: getSiteDescription(),
  faviconHref: getSiteFaviconHref(),
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <BaseRootLayout>
      {process.env.NODE_ENV === "development" ? <DevAutoReload /> : null}
      {children}
    </BaseRootLayout>
  );
}

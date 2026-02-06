import { createRootLayout } from '@metyatech/course-docs-platform/next-app/create-root-layout';
import { siteConfig } from '../../site.config';
import DevAutoReload from '../components/dev-auto-reload';
import MonacoLoader from '../components/monaco-loader';

const BaseRootLayout = createRootLayout({
  description: siteConfig.description ?? siteConfig.logoText,
  faviconHref: siteConfig.faviconHref ?? '/favicon.ico',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <BaseRootLayout>
      <MonacoLoader />
      {process.env.NODE_ENV === 'development' ? <DevAutoReload /> : null}
      {children}
    </BaseRootLayout>
  );
}

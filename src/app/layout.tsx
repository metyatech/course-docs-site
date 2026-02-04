import { createRootLayout } from '@metyatech/course-docs-platform/next-app/create-root-layout';
import { siteConfig } from '../../site.config';

export default createRootLayout({
  description: siteConfig.description ?? siteConfig.logoText,
  faviconHref: siteConfig.faviconHref ?? '/favicon.ico',
});

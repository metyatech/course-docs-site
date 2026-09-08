import 'nextra-theme-docs/style.css';
import '../../styles/course-base.css';
import '../../styles/course-admonition.css';
import '../../styles/course-site.css';
import '../../styles/course-tutorial.css';
import type { ReactNode } from 'react';
import { Head } from 'nextra/components';
import SearchSlashShortcutGuard from '../shared/search-slash-shortcut-guard.js';

type RootLayoutOptions = {
  description: string;
  faviconHref?: string;
  ogImageUrl?: string;
};

export function createRootLayout({
  description,
  faviconHref = '/img/favicon.ico',
  ogImageUrl,
}: RootLayoutOptions) {
  const resolvedOgImageUrl = ogImageUrl?.trim();

  return function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="ja" dir="ltr" suppressHydrationWarning>
        <Head>
          <meta name="description" content={description} />
          <link rel="icon" href={faviconHref} />
          {resolvedOgImageUrl ? (
            <>
              <meta property="og:image" content={resolvedOgImageUrl} />
              <meta name="twitter:card" content="summary_large_image" />
              <meta name="twitter:image" content={resolvedOgImageUrl} />
            </>
          ) : null}
        </Head>
        <body>
          <SearchSlashShortcutGuard />
          {children}
        </body>
      </html>
    );
  };
}

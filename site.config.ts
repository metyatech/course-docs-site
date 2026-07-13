export const siteConfig = {
  title: "Admin Fixture",
  logoText: "Admin Fixture",
  githubRepo: "metyatech/admin-fixture",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "admin mode fixture",
  faviconHref: "/img/favicon.ico",
  adminMode: {
    cookieName: 'course-docs-admin-fixture-session',
    publicFallbackPath: "/docs/intro",
    protectedLinks: [
      { href: "/docs/teacher-guide", label: "教員ガイド" },
      { href: "/docs/setup-and-troubleshooting", label: "セットアップ・トラブル対応" }
    ]
  }
} as const;

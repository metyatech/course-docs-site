import { siteConfig } from "../../site.config";

type SiteConfigShape = typeof siteConfig & {
  title?: string;
  logoText?: string;
  projectLink?: string;
  docsRepositoryBase?: string;
  githubRepo?: string;
  description?: string;
  faviconHref?: string;
};

const resolvedSiteConfig = siteConfig as SiteConfigShape;

const readTrimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const getSiteTitle = () =>
  readTrimmedString(resolvedSiteConfig.title) ||
  readTrimmedString(resolvedSiteConfig.logoText) ||
  "Course Docs";

export const getSiteLogoText = () =>
  readTrimmedString(resolvedSiteConfig.logoText) || getSiteTitle();

export const getSiteDescription = () =>
  readTrimmedString(resolvedSiteConfig.description) || getSiteTitle();

export const getSiteFaviconHref = () =>
  readTrimmedString(resolvedSiteConfig.faviconHref) || "/favicon.ico";

const getGitHubRepoUrl = () => {
  const githubRepo = readTrimmedString(resolvedSiteConfig.githubRepo);
  return githubRepo ? `https://github.com/${githubRepo}` : "";
};

export const getSiteProjectLink = () =>
  readTrimmedString(resolvedSiteConfig.projectLink) ||
  getGitHubRepoUrl() ||
  "https://example.invalid";

export const getSiteDocsRepositoryBase = () =>
  readTrimmedString(resolvedSiteConfig.docsRepositoryBase) ||
  (getGitHubRepoUrl() ? `${getGitHubRepoUrl()}/tree/main` : getSiteProjectLink());

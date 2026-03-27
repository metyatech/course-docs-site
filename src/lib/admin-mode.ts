import type { Meta, PageMapItem } from 'nextra';
import { siteConfig } from '../../site.config';

const DEFAULT_ADMIN_COOKIE_NAME = 'course-docs-admin-mode';
const DEFAULT_PUBLIC_FALLBACK_PATH = '/';
const RESERVED_META_KEYS = new Set(['*', 'index']);

type AdminModeLink = {
  href: string;
  label: string;
};

type AdminModeConfig = {
  protectedLinks?: AdminModeLink[];
  cookieName?: string;
  publicFallbackPath?: string;
};

type SiteConfigWithAdminMode = typeof siteConfig & {
  adminMode?: AdminModeConfig;
};

type StaticParams = {
  mdxPath?: string[];
  [key: string]: string | string[] | undefined;
};

const normalizeRoute = (route: string) => {
  const trimmed = route.trim();
  if (!trimmed) {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')) {
    return withLeadingSlash.slice(0, -1);
  }
  return withLeadingSlash;
};

const isAdminModeLink = (value: unknown): value is AdminModeLink => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeLink = value as Partial<AdminModeLink>;
  return typeof maybeLink.href === 'string' && typeof maybeLink.label === 'string';
};

const getAdminModeConfig = () => (siteConfig as SiteConfigWithAdminMode).adminMode;

const protectedLinks = (() => {
  const rawLinks = Array.isArray(getAdminModeConfig()?.protectedLinks)
    ? getAdminModeConfig()?.protectedLinks
    : [];

  const deduped = new Map<string, AdminModeLink>();
  for (const rawLink of rawLinks ?? []) {
    if (!isAdminModeLink(rawLink)) {
      continue;
    }

    const href = normalizeRoute(rawLink.href);
    deduped.set(href, {
      href,
      label: rawLink.label.trim() || href,
    });
  }

  return [...deduped.values()];
})();

const protectedRoutes = protectedLinks.map((link) => link.href);

export const getAdminModeCookieName = () => {
  const configured = getAdminModeConfig()?.cookieName?.trim();
  return configured || DEFAULT_ADMIN_COOKIE_NAME;
};

export const getAdminModePublicFallbackPath = () => {
  const configured = getAdminModeConfig()?.publicFallbackPath?.trim();
  return configured ? normalizeRoute(configured) : DEFAULT_PUBLIC_FALLBACK_PATH;
};

export const getAdminModeSecret = () =>
  (process.env.ADMIN_MODE_TOKEN ?? process.env.ADMIN_DELETE_TOKEN ?? '').trim();

export const getProtectedAdminLinks = () => protectedLinks;

export const hasProtectedAdminRoutes = () => protectedRoutes.length > 0;

export const isAdminModeConfigured = () =>
  hasProtectedAdminRoutes() && Boolean(getAdminModeSecret());

export const isAdminModeCookieEnabled = (cookieValue: string | null | undefined) =>
  cookieValue === '1';

export const isProtectedRoute = (pathname: string) => {
  const normalizedPath = normalizeRoute(pathname);
  return protectedRoutes.some(
    (protectedRoute) =>
      normalizedPath === protectedRoute || normalizedPath.startsWith(`${protectedRoute}/`)
  );
};

export const isProtectedMdxPath = (mdxPath: string[] | undefined) => {
  if (!mdxPath || mdxPath.length === 0) {
    return false;
  }
  return isProtectedRoute(`/${mdxPath.join('/')}`);
};

export const filterProtectedStaticParams = <T extends StaticParams>(params: T[]) =>
  params.filter((param) => {
    const mdxPath = Array.isArray(param.mdxPath) ? param.mdxPath : undefined;
    return !isProtectedMdxPath(mdxPath);
  });

const isPageMapMeta = (
  item: PageMapItem
): item is PageMapItem & { data: Record<string, unknown> } =>
  'data' in item && Boolean(item.data) && typeof item.data === 'object';

const isPageMapFolder = (
  item: PageMapItem
): item is PageMapItem & { route: string; children: PageMapItem[] } =>
  'route' in item &&
  typeof item.route === 'string' &&
  'children' in item &&
  Array.isArray(item.children);

const isPageMapRouteEntry = (
  item: PageMapItem
): item is PageMapItem & { route: string } => 'route' in item && typeof item.route === 'string';

export const filterProtectedPageMap = (
  items: PageMapItem[],
  parentRoute = ''
): PageMapItem[] =>
  items.reduce<PageMapItem[]>((filteredItems, item) => {
    if (isPageMapMeta(item)) {
      const filteredData = Object.fromEntries(
        Object.entries(item.data).filter(([key]) => {
          if (RESERVED_META_KEYS.has(key)) {
            return true;
          }
          return !isProtectedRoute(`${parentRoute}/${key}`);
        })
      ) as Record<string, Meta>;
      filteredItems.push({ ...item, data: filteredData });
      return filteredItems;
    }

    if (isPageMapFolder(item)) {
      if (isProtectedRoute(item.route)) {
        return filteredItems;
      }

      filteredItems.push({
        ...item,
        children: filterProtectedPageMap(item.children, item.route),
      });
      return filteredItems;
    }

    if (isPageMapRouteEntry(item) && isProtectedRoute(item.route)) {
      return filteredItems;
    }

    filteredItems.push(item);
    return filteredItems;
  }, []);

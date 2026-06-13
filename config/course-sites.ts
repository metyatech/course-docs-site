/**
 * Type-safe accessor for the single course-sites manifest.
 *
 * The manifest is the single source of truth for every course docs site
 * (6 sites today). It is consumed by:
 *   - the build matrix in `ci.yml` (one site per E2E profile)
 *   - the redeploy dispatch in `redeploy-content-sites.yml`
 *   - the local dev tooling (`npm run sync:content`, smoke test)
 *   - the manifest validator in `scripts/verify-course-sites-manifest.mjs`
 *
 * Adding a new site means adding ONE entry to `config/course-sites.json`
 * (and importing the typed shape here). Do not duplicate site lists.
 */
import manifestJson from './course-sites.json';

export type CourseSiteFeatures = {
  submissions: boolean;
  adminMode: boolean;
  pagefind: boolean;
  codePreview: boolean;
  exercises: boolean;
};

export type E2EProfile = 'docs-only' | 'submissions' | 'admin' | 'mixed';

export type CourseSite = {
  id: string;
  contentRepository: string;
  defaultContentRef: string;
  productionUrl: string;
  vercelProjectId: string;
  vercelOrgId: string;
  features: CourseSiteFeatures;
  e2eProfile: E2EProfile;
  smokeTestPaths: string[];
  redeployOnSiteChange: boolean;
  dispatchTarget: { owner: string; repo: string; workflow: string };
};

export type CourseSitesManifest = {
  version: 1;
  sites: CourseSite[];
};

const manifest = manifestJson as CourseSitesManifest;

if (manifest.version !== 1) {
  throw new Error(
    `[course-sites] Unsupported manifest version: ${manifest.version}. ` +
      `This build of course-docs-site only understands version 1.`,
  );
}

const allSites: readonly CourseSite[] = Object.freeze(manifest.sites);

const byId = new Map<string, CourseSite>(allSites.map((site) => [site.id, site]));
const ids = new Set<string>(allSites.map((site) => site.id));

if (ids.size !== allSites.length) {
  const seen = new Set<string>();
  const dups = allSites.map((s) => s.id).filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  throw new Error(
    `[course-sites] Duplicate site ids in manifest: ${dups.join(', ')}. ` +
      `Each id must appear exactly once.`,
  );
}

export const getAllSites = (): readonly CourseSite[] => allSites;

export const getSiteById = (id: string): CourseSite | undefined => byId.get(id);

export const requireSiteById = (id: string): CourseSite => {
  const site = byId.get(id);
  if (!site) {
    const known = [...ids].sort().join(', ');
    throw new Error(
      `[course-sites] Unknown site id "${id}". Known sites: ${known}.`,
    );
  }
  return site;
};

export const getSitesByE2EProfile = (profile: E2EProfile): CourseSite[] =>
  allSites.filter((site) => site.e2eProfile === profile);

export const getSitesWithFeature = (feature: keyof CourseSiteFeatures): CourseSite[] =>
  allSites.filter((site) => site.features[feature]);

export const getSitesWithSmokeTest = (): CourseSite[] => allSites;

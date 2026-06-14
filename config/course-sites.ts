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
import manifestJson from "./course-sites.json";

export type CourseSiteFeatures = {
  submissions: boolean;
  protectedDocs: boolean;
  adminCommentModeration: boolean;
  pagefind: boolean;
  codePreview: boolean;
  exercises: boolean;
};

export type E2EProfile = "docs-only" | "submissions" | "protected-admin";

export type CourseSite = {
  id: string;
  requiresContentReadToken: boolean;
  contentRepository: string;
  defaultContentRef: string;
  productionUrl: string;
  features: CourseSiteFeatures;
  e2eProfile: E2EProfile;
  representativeE2E: boolean;
  e2ePort?: number;
  e2eSourceEnv?: string;
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
  throw new Error(`[course-sites] Unsupported manifest version: ${manifest.version}.`);
}

const allSites: readonly CourseSite[] = Object.freeze(manifest.sites);

const byId = new Map<string, CourseSite>(allSites.map((site) => [site.id, site]));
const byRepo = new Map<string, CourseSite>(allSites.map((site) => [site.contentRepository, site]));
const ids = new Set<string>(allSites.map((site) => site.id));

if (ids.size !== allSites.length) {
  throw new Error(`[course-sites] Duplicate site ids in manifest.`);
}

export const getAllSites = (): readonly CourseSite[] => allSites;

export const getSiteById = (id: string): CourseSite | undefined => byId.get(id);

export const requireSiteById = (id: string): CourseSite => {
  const site = byId.get(id);
  if (!site) {
    throw new Error(`[course-sites] Unknown site id "${id}".`);
  }
  return site;
};

export const getSiteByContentRepository = (repository: string): CourseSite | undefined =>
  byRepo.get(repository);

export const getBuildSites = (): readonly CourseSite[] => allSites;

export const getRepresentativeE2ESites = (): readonly CourseSite[] =>
  allSites.filter((site) => site.representativeE2E === true);

export const getRedeploySites = (): readonly CourseSite[] =>
  allSites.filter((site) => site.redeployOnSiteChange === true);

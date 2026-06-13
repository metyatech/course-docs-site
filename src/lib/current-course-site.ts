import { siteConfig } from "../../site.config";
import { getSiteByContentRepository, type CourseSite } from "../../config/course-sites";

/**
 * Returns the current site definition by matching `siteConfig.githubRepo`
 * against the `contentRepository` field of the manifest.
 *
 * Returns `undefined` if no match is found (e.g. for an unrecognised fixture
 * course or a partially-configured environment). Callers should treat the
 * undefined case as "no site-specific data is available" and fall back to a
 * safe default rather than crashing.
 */
export const getCurrentCourseSite = (): CourseSite | undefined => {
  const repo = siteConfig.githubRepo;
  return getSiteByContentRepository(repo);
};

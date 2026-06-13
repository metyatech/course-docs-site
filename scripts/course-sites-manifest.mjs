import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const manifestPath = path.join(repoRoot, "config", "course-sites.json");
const schemaPath = path.join(repoRoot, "config", "course-sites.schema.json");

export const REQUIRED_SITE_IDS = [
  "course-common-docs",
  "javascript-course-docs",
  "programming-course-docs",
  "web-foundations-docs",
  "open-campus-unreal-90min",
  "teacher-profile-docs",
];

export const E2E_PROFILES = ["docs-only", "submissions", "protected-admin"];

export const REPRESENTATIVE_BY_PROFILE = {
  "docs-only": "javascript-course-docs",
  submissions: "programming-course-docs",
  "protected-admin": "open-campus-unreal-90min",
};

const FORBIDDEN_PLACEHOLDER_VALUES = ["VERCEL_PROJECT_ID", "VERCEL_ORG_ID"];

export class CourseSitesManifestError extends Error {
  constructor(errors) {
    super(`Invalid course sites manifest:\n${errors.join("\n")}`);
    this.name = "CourseSitesManifestError";
    this.errors = errors;
  }
}

export const readManifestFile = () => JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

export const readSchemaFile = () => JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

// Backwards-compatible loader (raw read, no validation).
export const readCourseSitesManifest = () => readManifestFile();

let cachedValidator = null;
const getValidator = () => {
  if (cachedValidator) return cachedValidator;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidator = ajv.compile(readSchemaFile());
  return cachedValidator;
};

const repoName = (fullName) => String(fullName).split("/").pop();

const deepFindForbiddenValues = (value, forbidden) => {
  const hits = new Set();
  const walk = (node) => {
    if (typeof node === "string") {
      if (forbidden.includes(node)) hits.add(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (forbidden.includes(key)) hits.add(key);
        walk(child);
      }
    }
  };
  walk(value);
  return [...hits];
};

export const validateSchema = (manifest) => {
  const validate = getValidator();
  const valid = validate(manifest);
  if (valid) return [];
  return (validate.errors ?? []).map(
    (e) =>
      `schema: ${e.instancePath || "/"} ${e.message}` +
      (e.params && Object.keys(e.params).length ? ` (${JSON.stringify(e.params)})` : ""),
  );
};

export const validateCrossConstraints = (manifest) => {
  const errors = [];
  const sites = Array.isArray(manifest?.sites) ? manifest.sites : [];

  // Forbidden Vercel placeholders anywhere in the document.
  for (const hit of deepFindForbiddenValues(manifest, FORBIDDEN_PLACEHOLDER_VALUES)) {
    errors.push(`forbidden Vercel placeholder present: ${hit}`);
  }

  // Unique ids.
  const seenIds = new Set();
  for (const site of sites) {
    if (seenIds.has(site.id)) errors.push(`duplicate site id: ${site.id}`);
    seenIds.add(site.id);
  }

  // Unique content repositories.
  const seenRepos = new Set();
  for (const site of sites) {
    if (seenRepos.has(site.contentRepository))
      errors.push(`duplicate contentRepository: ${site.contentRepository}`);
    seenRepos.add(site.contentRepository);
  }

  // Unique dispatch owner/repo.
  const seenDispatch = new Set();
  for (const site of sites) {
    const key = `${site.dispatchTarget?.owner}/${site.dispatchTarget?.repo}`;
    if (seenDispatch.has(key)) errors.push(`duplicate dispatchTarget: ${key}`);
    seenDispatch.add(key);
  }

  // All required site ids present.
  for (const id of REQUIRED_SITE_IDS) {
    if (!seenIds.has(id)) errors.push(`required site missing: ${id}`);
  }

  // contentRepository repo name matches dispatchTarget.repo.
  for (const site of sites) {
    if (repoName(site.contentRepository) !== site.dispatchTarget?.repo) {
      errors.push(
        `dispatchTarget.repo (${site.dispatchTarget?.repo}) must match contentRepository repo (${repoName(site.contentRepository)}) for ${site.id}`,
      );
    }
  }

  // Feature/profile coherence.
  for (const site of sites) {
    if (site.e2eProfile === "submissions" && site.features?.submissions !== true) {
      errors.push(`site ${site.id} has submissions profile but features.submissions is not true`);
    }
    if (site.e2eProfile === "protected-admin" && site.features?.protectedDocs !== true) {
      errors.push(
        `site ${site.id} has protected-admin profile but features.protectedDocs is not true`,
      );
    }
    if (site.features?.adminCommentModeration === true && site.features?.submissions !== true) {
      errors.push(`site ${site.id} enables adminCommentModeration but submissions is not true`);
    }
    if (site.features?.protectedDocs === true && site.e2eProfile !== "protected-admin") {
      errors.push(`site ${site.id} has protectedDocs but is not on the protected-admin profile`);
    }
  }

  // Exactly one representative per profile, with the fixed expected id.
  for (const profile of E2E_PROFILES) {
    const reps = sites.filter((s) => s.e2eProfile === profile && s.representativeE2E === true);
    if (reps.length !== 1) {
      errors.push(
        `e2e profile ${profile} must have exactly one representative site (found ${reps.length})`,
      );
      continue;
    }
    const expected = REPRESENTATIVE_BY_PROFILE[profile];
    if (reps[0].id !== expected) {
      errors.push(
        `representative for profile ${profile} must be ${expected} (found ${reps[0].id})`,
      );
    }
  }

  return errors;
};

export const validateManifest = (manifest) => {
  const schemaErrors = validateSchema(manifest);
  // Cross constraints still run so callers see every problem at once.
  const constraintErrors = validateCrossConstraints(manifest);
  return [...schemaErrors, ...constraintErrors];
};

export const loadCourseSitesManifest = (manifest = readManifestFile()) => {
  const errors = validateManifest(manifest);
  if (errors.length) throw new CourseSitesManifestError(errors);
  return manifest;
};

export const courseSourceOf = (site) =>
  `github:${site.contentRepository}#${site.defaultContentRef}`;

export const buildMatrix = (manifest = readManifestFile()) =>
  manifest.sites.map((site) => ({
    siteId: site.id,
    courseSource: courseSourceOf(site),
  }));

export const representativeE2EMatrix = (manifest = readManifestFile()) =>
  manifest.sites
    .filter((site) => site.representativeE2E === true)
    .map((site) => ({
      siteId: site.id,
      courseSource: courseSourceOf(site),
      e2ePort: site.e2ePort,
      e2eProfile: site.e2eProfile,
    }));

export const redeployMatrix = (manifest = readManifestFile()) =>
  manifest.sites
    .filter((site) => site.redeployOnSiteChange === true)
    .map((site) => ({
      siteId: site.id,
      repo: site.dispatchTarget.repo,
      ref: site.defaultContentRef,
      workflow: site.dispatchTarget.workflow,
    }));

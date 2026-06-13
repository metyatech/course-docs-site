#!/usr/bin/env node
/**
 * Validates config/course-sites.json against the schema and the runtime
 * invariants. Wired into `npm run verify` and CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const manifestPath = path.join(repoRoot, 'config', 'course-sites.json');
const schemaPath = path.join(repoRoot, 'config', 'course-sites.schema.json');

const ALLOWED_E2E_PROFILES = new Set(['docs-only', 'submissions', 'admin', 'mixed']);
const REQUIRED_PROFILE_REPRESENTATION = ['docs-only', 'submissions', 'admin'];

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));

const manifest = readJson(manifestPath);
const schema = readJson(schemaPath);

const errors = [];
const ok = (msg) => process.stdout.write(`  \u2713 ${msg}\n`);
const fail = (msg) => {
  errors.push(msg);
  process.stderr.write(`  \u2717 ${msg}\n`);
};

process.stdout.write(`[verify-course-sites] Checking ${path.relative(repoRoot, manifestPath)}\n`);

if (typeof manifest !== 'object' || manifest == null) {
  fail('Manifest must be a JSON object');
  process.exit(1);
}
if (manifest.version !== schema.properties.version.const) {
  fail(`Manifest version must be ${schema.properties.version.const}, got ${manifest.version}`);
} else {
  ok(`manifest.version = ${manifest.version}`);
}
if (!Array.isArray(manifest.sites)) {
  fail('Manifest must have a "sites" array');
  process.exit(1);
}
if (manifest.sites.length < 6) {
  fail(`At least 6 sites required, got ${manifest.sites.length}`);
} else {
  ok(`${manifest.sites.length} sites registered (>= 6)`);
}

const seenIds = new Set();
for (const site of manifest.sites) {
  if (seenIds.has(site.id)) fail(`Duplicate site id: ${site.id}`);
  seenIds.add(site.id);

  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(site.id)) {
    fail(`Site id "${site.id}" does not match required pattern`);
  }
  if (!/^metyatech\/[a-z0-9._-]+$/.test(site.contentRepository)) {
    fail(`Site "${site.id}" contentRepository "${site.contentRepository}" does not match metyatech/<name> pattern`);
  }
  if (typeof site.defaultContentRef !== 'string' || site.defaultContentRef.length === 0) {
    fail(`Site "${site.id}" defaultContentRef must be a non-empty string`);
  }
  if (!/^https:\/\//.test(site.productionUrl)) {
    fail(`Site "${site.id}" productionUrl must be https://, got "${site.productionUrl}"`);
  }
  if (typeof site.vercelProjectId !== 'string' || site.vercelProjectId.length === 0) {
    fail(`Site "${site.id}" vercelProjectId must be a non-empty string`);
  }
  if (typeof site.vercelOrgId !== 'string' || site.vercelOrgId.length === 0) {
    fail(`Site "${site.id}" vercelOrgId must be a non-empty string`);
  }
  if (!ALLOWED_E2E_PROFILES.has(site.e2eProfile)) {
    fail(`Site "${site.id}" e2eProfile "${site.e2eProfile}" is not in ${[...ALLOWED_E2E_PROFILES].join('|')}`);
  }
  if (!Array.isArray(site.smokeTestPaths) || site.smokeTestPaths.length < 2) {
    fail(`Site "${site.id}" smokeTestPaths must be an array of >= 2 paths`);
  } else {
    for (const p of site.smokeTestPaths) {
      if (typeof p !== 'string' || !p.startsWith('/')) {
        fail(`Site "${site.id}" smokeTestPaths entry "${p}" must be a path starting with "/"`);
      }
    }
  }
  if (typeof site.redeployOnSiteChange !== 'boolean') {
    fail(`Site "${site.id}" redeployOnSiteChange must be boolean`);
  }
  if (!site.dispatchTarget || typeof site.dispatchTarget.workflow !== 'string') {
    fail(`Site "${site.id}" dispatchTarget.workflow must be a string`);
  }
  if (site.features) {
    for (const key of ['submissions', 'adminMode', 'pagefind', 'codePreview', 'exercises']) {
      if (typeof site.features[key] !== 'boolean') {
        fail(`Site "${site.id}" features.${key} must be boolean`);
      }
    }
  } else {
    fail(`Site "${site.id}" missing "features" block`);
  }
}
ok(`All ${seenIds.size} site ids are unique`);

const presentProfiles = new Set(manifest.sites.map((s) => s.e2eProfile));
for (const required of REQUIRED_PROFILE_REPRESENTATION) {
  if (!presentProfiles.has(required)) {
    fail(`E2E profile "${required}" must be represented by at least one site (used in CI build matrix)`);
  } else {
    ok(`E2E profile "${required}" has at least one site`);
  }
}

const requiredIds = [
  'course-common-docs',
  'javascript-course-docs',
  'programming-course-docs',
  'web-foundations-docs',
  'open-campus-unreal-90min',
  'teacher-profile-docs',
];
for (const id of requiredIds) {
  if (!seenIds.has(id)) {
    fail(`Required site id "${id}" missing from manifest`);
  } else {
    ok(`site "${id}" present`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`\n[verify-course-sites] FAILED: ${errors.length} error(s)\n`);
  process.exit(1);
}
process.stdout.write(`\n[verify-course-sites] OK\n`);

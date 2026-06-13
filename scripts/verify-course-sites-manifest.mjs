#!/usr/bin/env node
/**
 * Validates config/course-sites.json against the schema and the runtime
 * invariants using the shared manifest loader. Wired into `npm run verify:sites`
 * and CI. All Ajv schema errors and cross-constraint errors are printed; the
 * process exits 1 on any failure.
 */
import { readManifestFile, validateManifest } from "./course-sites-manifest.mjs";

let manifest;
try {
  manifest = readManifestFile();
} catch (error) {
  console.error(`[verify-course-sites] failed to read manifest: ${error.message}`);
  process.exit(1);
}

const errors = validateManifest(manifest);
if (errors.length) {
  console.error("[verify-course-sites] FAILED");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("[verify-course-sites] OK");

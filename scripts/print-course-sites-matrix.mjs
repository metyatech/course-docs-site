#!/usr/bin/env node
/**
 * Prints a CI matrix derived from config/course-sites.json as compact JSON
 * (no trailing newline). The manifest is fully validated before any matrix is
 * emitted, so an invalid manifest fails the job instead of producing a matrix.
 *
 * Usage:
 *   node scripts/print-course-sites-matrix.mjs --kind build
 *   node scripts/print-course-sites-matrix.mjs --kind e2e
 *   node scripts/print-course-sites-matrix.mjs --kind redeploy
 */
import {
  loadCourseSitesManifest,
  buildMatrix,
  representativeE2EMatrix,
  redeployMatrix,
} from "./course-sites-manifest.mjs";

const parseKind = (argv) => {
  const idx = argv.indexOf("--kind");
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1];
};

const kind = parseKind(process.argv.slice(2));
if (!kind || !["build", "e2e", "redeploy"].includes(kind)) {
  console.error("usage: print-course-sites-matrix.mjs --kind <build|e2e|redeploy>");
  process.exit(1);
}

let manifest;
try {
  manifest = loadCourseSitesManifest();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const matrix =
  kind === "build"
    ? buildMatrix(manifest)
    : kind === "e2e"
      ? representativeE2EMatrix(manifest)
      : redeployMatrix(manifest);

process.stdout.write(JSON.stringify(matrix));

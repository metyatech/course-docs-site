import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readManifestFile,
  validateManifest,
  loadCourseSitesManifest,
  buildMatrix,
  representativeE2EMatrix,
  redeployMatrix,
} from "../scripts/course-sites-manifest.mjs";

const baseManifest = () => structuredClone(readManifestFile());
const siteById = (manifest, id) => manifest.sites.find((s) => s.id === id);

test("the shipped manifest passes schema and cross constraints", () => {
  assert.deepEqual(validateManifest(readManifestFile()), []);
  assert.doesNotThrow(() => loadCourseSitesManifest());
});

test("build matrix contains all six sites with course sources", () => {
  const matrix = buildMatrix(readManifestFile());
  assert.equal(matrix.length, 6);
  const byId = Object.fromEntries(matrix.map((m) => [m.siteId, m.courseSource]));
  assert.equal(byId["javascript-course-docs"], "github:metyatech/javascript-course-docs#master");
  assert.equal(byId["course-common-docs"], "github:metyatech/course-common-docs#main");
  for (const entry of matrix) {
    assert.ok(/^github:metyatech\/[a-z0-9-]+#\S+$/.test(entry.courseSource));
  }
});

test("E2E matrix contains exactly the three representative sites", () => {
  const matrix = representativeE2EMatrix(readManifestFile());
  assert.equal(matrix.length, 3);
  const ids = matrix.map((m) => m.siteId).sort();
  assert.deepEqual(ids, [
    "javascript-course-docs",
    "open-campus-unreal-90min",
    "programming-course-docs",
  ]);
  const byId = Object.fromEntries(matrix.map((m) => [m.siteId, m]));
  assert.equal(byId["programming-course-docs"].e2ePort, 3101);
  assert.equal(byId["javascript-course-docs"].e2ePort, 3102);
  assert.equal(byId["open-campus-unreal-90min"].e2ePort, 3103);
  assert.equal(byId["open-campus-unreal-90min"].e2eProfile, "protected-admin");
});

test("redeploy matrix contains all six sites with repo/ref/workflow", () => {
  const matrix = redeployMatrix(readManifestFile());
  assert.equal(matrix.length, 6);
  for (const entry of matrix) {
    assert.ok(entry.siteId);
    assert.ok(entry.repo);
    assert.ok(entry.ref);
    assert.equal(entry.workflow, "deploy-vercel.yml");
  }
  const prog = matrix.find((m) => m.siteId === "programming-course-docs");
  assert.equal(prog.ref, "master");
  assert.equal(prog.repo, "programming-course-docs");
});

test("duplicate site id is rejected", () => {
  const m = baseManifest();
  m.sites[1].id = m.sites[0].id;
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /duplicate site id/.test(e)));
});

test("duplicate content repository is rejected", () => {
  const m = baseManifest();
  m.sites[1].contentRepository = m.sites[0].contentRepository;
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /duplicate contentRepository/.test(e)));
});

test("unknown e2e profile is rejected", () => {
  const m = baseManifest();
  m.sites[0].e2eProfile = "mystery";
  const errors = validateManifest(m);
  assert.ok(errors.length > 0);
});

test("missing required site is rejected", () => {
  const m = baseManifest();
  // Replace a required id with a non-required duplicate-free id.
  siteById(m, "teacher-profile-docs").id = "extra-docs";
  siteById(m, "extra-docs").contentRepository = "metyatech/extra-docs";
  siteById(m, "extra-docs").dispatchTarget.repo = "extra-docs";
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /required site missing: teacher-profile-docs/.test(e)));
});

test("duplicate representative for a profile is rejected", () => {
  const m = baseManifest();
  const common = siteById(m, "course-common-docs");
  common.representativeE2E = true;
  common.e2ePort = 3199;
  common.e2eSourceEnv = "E2E_COMMON_CONTENT_SOURCE";
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /exactly one representative/.test(e)));
});

test("missing representative for a profile is rejected", () => {
  const m = baseManifest();
  const js = siteById(m, "javascript-course-docs");
  js.representativeE2E = false;
  delete js.e2ePort;
  delete js.e2eSourceEnv;
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /exactly one representative/.test(e)));
});

test("submissions profile without submissions feature is rejected", () => {
  const m = baseManifest();
  const common = siteById(m, "course-common-docs");
  common.e2eProfile = "submissions";
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /submissions profile but features.submissions/.test(e)));
});

test("protectedDocs without protected-admin profile is rejected", () => {
  const m = baseManifest();
  siteById(m, "course-common-docs").features.protectedDocs = true;
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /protectedDocs but is not on the protected-admin profile/.test(e)));
});

test("adminCommentModeration without submissions is rejected", () => {
  const m = baseManifest();
  siteById(m, "course-common-docs").features.adminCommentModeration = true;
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /adminCommentModeration but submissions is not true/.test(e)));
});

test("placeholder Vercel values are rejected", () => {
  const m = baseManifest();
  m.sites[0].vercelProjectId = "VERCEL_PROJECT_ID";
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /VERCEL_PROJECT_ID/.test(e)));
});

test("unknown additional property is rejected", () => {
  const m = baseManifest();
  m.sites[0].surpriseField = true;
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /schema:/.test(e)));
});

test("non-https production url is rejected", () => {
  const m = baseManifest();
  m.sites[0].productionUrl = "not-a-real-url";
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /schema:/.test(e)));
});

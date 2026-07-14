import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readManifestFile,
  validateManifest,
  loadCourseSitesManifest,
  buildMatrix,
  representativeE2EMatrix,
  redeployMatrix,
} from "../scripts/course-sites-manifest.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runMatrixCli = (kind) => {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, "scripts", "print-course-sites-matrix.mjs"), "--kind", kind],
    { encoding: "utf8", cwd: projectRoot },
  );
  if (result.status !== 0) {
    throw new Error(
      `matrix CLI failed (kind=${kind}, exit=${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return result.stdout;
};

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

test("matrix CLI: build output is an object with include.length === 6", () => {
  const stdout = runMatrixCli("build");
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed, "object");
  assert.ok(parsed !== null, "CLI output must be a JSON object");
  assert.ok(!Array.isArray(parsed), "top-level must not be an array");
  assert.ok(Array.isArray(parsed.include), "parsed.include must be an array");
  assert.equal(parsed.include.length, 6);
});

test("matrix CLI: e2e output is an object with include.length === 6", () => {
  const stdout = runMatrixCli("e2e");
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed, "object");
  assert.ok(parsed !== null, "CLI output must be a JSON object");
  assert.ok(!Array.isArray(parsed), "top-level must not be an array");
  assert.ok(Array.isArray(parsed.include), "parsed.include must be an array");
  assert.equal(parsed.include.length, 6);
});

test("matrix CLI: redeploy output is an object with include.length === 6", () => {
  const stdout = runMatrixCli("redeploy");
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed, "object");
  assert.ok(parsed !== null, "CLI output must be a JSON object");
  assert.ok(!Array.isArray(parsed), "top-level must not be an array");
  assert.ok(Array.isArray(parsed.include), "parsed.include must be an array");
  assert.equal(parsed.include.length, 6);
});

test("matrix CLI: stdout is parseable JSON with no stray log lines", () => {
  for (const kind of ["build", "e2e", "redeploy"]) {
    const stdout = runMatrixCli(kind);
    assert.ok(!/\n/.test(stdout), `matrix CLI stdout (${kind}) must not contain newlines`);
    assert.doesNotThrow(() => JSON.parse(stdout), `matrix CLI stdout (${kind}) must be valid JSON`);
  }
});

test("matrix CLI: top-level shape is `{ include: [...] }`, not a bare array", () => {
  for (const kind of ["build", "e2e", "redeploy"]) {
    const stdout = runMatrixCli(kind);
    const parsed = JSON.parse(stdout);
    assert.ok(!Array.isArray(parsed), `top-level (${kind}) must not be a bare array`);
    assert.ok("include" in parsed, `top-level (${kind}) must contain an "include" key`);
    assert.ok(
      Object.keys(parsed).every((k) => k === "include"),
      `top-level (${kind}) must only contain "include"`,
    );
  }
});

test("build matrix: teacher-profile-docs entry has requiresContentReadToken === true", () => {
  const matrix = buildMatrix(readManifestFile());
  const entry = matrix.find((m) => m.siteId === "teacher-profile-docs");
  assert.ok(entry, "teacher-profile-docs must be present in the build matrix");
  assert.equal(entry.requiresContentReadToken, true);
});

test("build matrix: every non-teacher-profile entry has requiresContentReadToken === false", () => {
  const matrix = buildMatrix(readManifestFile());
  const others = matrix.filter((m) => m.siteId !== "teacher-profile-docs");
  assert.equal(others.length, 5);
  for (const entry of others) {
    assert.equal(entry.requiresContentReadToken, false);
  }
});

test("E2E matrix: every entry has requiresContentReadToken === false (current reps are public)", () => {
  const matrix = representativeE2EMatrix(readManifestFile());
  assert.equal(matrix.length, 3);
  for (const entry of matrix) {
    assert.equal(entry.requiresContentReadToken, false);
  }
});

test("cross constraints: teacher-profile-docs requiresContentReadToken=false is rejected", () => {
  const m = baseManifest();
  siteById(m, "teacher-profile-docs").requiresContentReadToken = false;
  const errors = validateManifest(m);
  assert.ok(
    errors.some((e) => /teacher-profile-docs must set requiresContentReadToken=true/.test(e)),
    `expected teacher-profile-docs error, got: ${errors.join("\n")}`,
  );
});

test("cross constraints: a public site requiresContentReadToken=true is rejected", () => {
  const m = baseManifest();
  siteById(m, "javascript-course-docs").requiresContentReadToken = true;
  const errors = validateManifest(m);
  assert.ok(
    errors.some((e) => /javascript-course-docs must set requiresContentReadToken=false/.test(e)),
    `expected javascript-course-docs error, got: ${errors.join("\n")}`,
  );
});

test("matrix CLI: build output includes requiresContentReadToken for every entry", () => {
  const stdout = runMatrixCli("build");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.include.length, 6);
  for (const entry of parsed.include) {
    assert.equal(
      typeof entry.requiresContentReadToken,
      "boolean",
      `entry ${entry.siteId} must include a boolean requiresContentReadToken`,
    );
  }
  const teacher = parsed.include.find((e) => e.siteId === "teacher-profile-docs");
  assert.equal(teacher.requiresContentReadToken, true);
});

test("matrix CLI: e2e output expands every representative course into two shards", () => {
  const stdout = runMatrixCli("e2e");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.include.length, 6);
  const shardsBySite = new Map();
  for (const entry of parsed.include) {
    assert.equal(
      typeof entry.requiresContentReadToken,
      "boolean",
      `entry ${entry.siteId} must include a boolean requiresContentReadToken`,
    );
    assert.ok(["1/2", "2/2"].includes(entry.shard), `unexpected shard for ${entry.siteId}`);
    const shards = shardsBySite.get(entry.siteId) ?? [];
    shards.push(entry.shard);
    shardsBySite.set(entry.siteId, shards);
  }
  assert.deepEqual([...shardsBySite.keys()].sort(), [
    "javascript-course-docs",
    "open-campus-unreal-90min",
    "programming-course-docs",
  ]);
  for (const shards of shardsBySite.values()) {
    assert.deepEqual(shards.sort(), ["1/2", "2/2"]);
  }
});

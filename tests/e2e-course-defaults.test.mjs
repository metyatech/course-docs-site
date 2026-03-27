import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveCourseSuiteConfig } = require("./e2e/course-defaults.cjs");

test("programming-course-docs uses the html basics code preview route", () => {
  const config = resolveCourseSuiteConfig("github:metyatech/programming-course-docs#master");

  assert.equal(config.docsIntroPath, "/docs/intro");
  assert.equal(config.submissionsPath, "/submissions");
  assert.equal(config.codePreviewPath, "/docs/html-basics/introduction");
  assert.equal(config.codePreviewExpectedText, "<body>");
  assert.equal(config.enableSubmissions, true);
  assert.equal(config.enableCodePreview, true);
});

test("javascript-course-docs keeps submissions disabled", () => {
  const config = resolveCourseSuiteConfig("../javascript-course-docs");

  assert.equal(config.codePreviewPath, "/docs/basics/array-intro");
  assert.equal(config.codePreviewExpectedText, "schools");
  assert.equal(config.enableSubmissions, false);
  assert.equal(config.enableCodePreview, true);
});

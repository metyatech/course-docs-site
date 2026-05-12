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
  assert.deepEqual(config.exerciseContrastPaths, []);
  assert.equal(config.enableSubmissions, true);
  assert.equal(config.enableCodePreview, true);
});

test("javascript-course-docs keeps submissions disabled", () => {
  const config = resolveCourseSuiteConfig("../javascript-course-docs");

  assert.equal(config.codePreviewPath, "/docs/basics/array-intro");
  assert.equal(config.codePreviewExpectedText, "schools");
  assert.deepEqual(config.exerciseContrastPaths, [
    "/docs/basics/array-intro",
    "/docs/basics/array-methods",
    "/docs/basics/conditionals-if-elseif",
    "/docs/basics/dom-css",
    "/docs/basics/dom-css-class-transition",
    "/docs/basics/dom-css-transition",
    "/docs/basics/dom-events",
    "/docs/basics/dom-innertext",
    "/docs/basics/for-loop-break-debug",
    "/docs/basics/function-intro",
    "/docs/basics/function-return",
    "/docs/basics/introduction",
    "/docs/basics/object-intro",
    "/docs/basics/operators-and-conversion",
    "/docs/basics/types-and-prompt",
    "/docs/basics/variables-comments-assignment",
    "/docs/review/comprehensive-practice",
    "/docs/ui-components/accordion-menu_jquery-slidetoggle",
    "/docs/ui-components/drawer-menu",
    "/docs/ui-components/dropdown-menu",
    "/docs/ui-components/popup_magnific-popup",
    "/docs/ui-components/show-more",
    "/docs/ui-components/slider_swiper"
  ]);
  assert.equal(config.enableSubmissions, false);
  assert.equal(config.enableCodePreview, true);
});

test("open-campus-unreal-90min disables submissions and code preview", () => {
  const config = resolveCourseSuiteConfig("../open-campus-unreal-90min");

  assert.equal(config.docsIntroPath, "/docs/intro");
  assert.deepEqual(config.exerciseContrastPaths, []);
  assert.equal(config.enableSubmissions, false);
  assert.equal(config.enableCodePreview, false);
});

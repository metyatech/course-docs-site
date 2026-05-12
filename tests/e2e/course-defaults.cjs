const GENERIC_DEFAULTS = {
  docsIntroPath: "/docs/intro",
  submissionsPath: "/submissions",
  codePreviewPath: "/docs/basics/array-intro",
  codePreviewExpectedText: "schools",
  exerciseContrastPaths: [],
  enableSubmissions: true,
  enableCodePreview: true,
};

const COURSE_DEFAULTS = {
  "programming-course-docs": {
    codePreviewPath: "/docs/html-basics/introduction",
    codePreviewExpectedText: "<body>",
  },
  "javascript-course-docs": {
    exerciseContrastPaths: [
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
    ],
    enableSubmissions: false,
  },
  "open-campus-unreal-90min": {
    enableSubmissions: false,
    enableCodePreview: false,
  },
};

const normalizeSourceText = (sourceText) =>
  typeof sourceText === "string" ? sourceText.trim().toLowerCase() : "";

const resolveCourseKey = (sourceText) => {
  const normalized = normalizeSourceText(sourceText);
  if (!normalized) {
    return "";
  }

  for (const courseKey of Object.keys(COURSE_DEFAULTS)) {
    if (normalized.includes(courseKey)) {
      return courseKey;
    }
  }

  return "";
};

const resolveCourseSuiteConfig = (sourceText) => {
  const courseKey = resolveCourseKey(sourceText);
  return {
    ...GENERIC_DEFAULTS,
    ...(courseKey ? COURSE_DEFAULTS[courseKey] : {}),
  };
};

module.exports = {
  GENERIC_DEFAULTS,
  COURSE_DEFAULTS,
  resolveCourseKey,
  resolveCourseSuiteConfig,
};

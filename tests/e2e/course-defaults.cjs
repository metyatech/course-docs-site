const GENERIC_DEFAULTS = {
  docsIntroPath: "/docs/intro",
  submissionsPath: "/submissions",
  codePreviewPath: "/docs/basics/array-intro",
  codePreviewExpectedText: "schools",
  enableSubmissions: true,
  enableCodePreview: true,
};

const COURSE_DEFAULTS = {
  "programming-course-docs": {
    codePreviewPath: "/docs/html-basics/introduction",
    codePreviewExpectedText: "<body>",
  },
  "javascript-course-docs": {
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

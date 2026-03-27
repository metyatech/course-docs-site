const fs = require("node:fs");
const path = require("node:path");
const { resolveCourseSuiteConfig } = require("./course-defaults.cjs");

const suiteConfigPath = path.join(__dirname, ".suite-config.json");
const defaultSuiteConfig = resolveCourseSuiteConfig(process.env.COURSE_CONTENT_SOURCE);

const readSuiteConfigFile = () => {
  try {
    if (!fs.existsSync(suiteConfigPath)) {
      return {};
    }
    const raw = fs.readFileSync(suiteConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const fileConfig = readSuiteConfigFile();

const readString = (fileKey, envKey, fallback) => {
  const fileValue = fileConfig[fileKey];
  if (typeof fileValue === "string") {
    const trimmed = fileValue.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const envValue = process.env[envKey];
  if (typeof envValue !== "string") {
    return fallback;
  }
  const trimmed = envValue.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const parseBoolean = (fileKey, envKey, fallback) => {
  const fileValue = fileConfig[fileKey];
  if (typeof fileValue === "boolean") {
    return fileValue;
  }

  const envValue = process.env[envKey];
  if (typeof envValue !== "string") {
    return fallback;
  }
  const normalized = envValue.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
};

const suiteConfig = {
  docsIntroPath: readString(
    "docsIntroPath",
    "E2E_DOCS_INTRO_PATH",
    defaultSuiteConfig.docsIntroPath,
  ),
  submissionsPath: readString(
    "submissionsPath",
    "E2E_SUBMISSIONS_PATH",
    defaultSuiteConfig.submissionsPath,
  ),
  codePreviewPath: readString(
    "codePreviewPath",
    "E2E_CODE_PREVIEW_PATH",
    defaultSuiteConfig.codePreviewPath,
  ),
  codePreviewExpectedText: readString(
    "codePreviewExpectedText",
    "E2E_CODE_PREVIEW_EXPECT_TEXT",
    defaultSuiteConfig.codePreviewExpectedText,
  ),
  enableSubmissions: parseBoolean(
    "enableSubmissions",
    "E2E_ENABLE_SUBMISSIONS",
    defaultSuiteConfig.enableSubmissions,
  ),
  enableCodePreview: parseBoolean(
    "enableCodePreview",
    "E2E_ENABLE_CODE_PREVIEW",
    defaultSuiteConfig.enableCodePreview,
  ),
};

module.exports = { suiteConfig, suiteConfigPath };

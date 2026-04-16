import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createDefaultTutorialShotManifest,
  deriveTutorialShotPaths,
  extractActionImageRefsFromMdx,
  extractVerifyImageRefsFromMdx,
  getTutorialPageModeWarnings,
  getTutorialShotAnnotationErrors,
  getTutorialShotCanvasLayout,
  getTutorialShotWarnings,
  normalizeDecodedPosixPath,
  normalizePosixPath,
  normalizeTutorialShotManifest,
  renderTutorialShotOverlaySvg,
} from "./tutorial-shots-shared.mjs";

const IMAGE_PATH_PATTERN = /^content\/.+\.(png|jpe?g|webp)$/iu;
const PAGE_PATH_PATTERN = /^content\/.+\/index\.mdx?$/iu;

const isLocalPathLike = (value) =>
  value.startsWith(".") ||
  value.startsWith("/") ||
  value.startsWith("\\") ||
  /^[a-zA-Z]:[\\/]/u.test(value);

const hasRequiredCourseRepoShape = async (directoryPath) => {
  const contentDir = path.join(directoryPath, "content");
  const siteConfigPath = path.join(directoryPath, "site.config.ts");

  const [hasContentDir, hasSiteConfig] = await Promise.all([
    fs
      .stat(contentDir)
      .then((stats) => stats.isDirectory())
      .catch(() => false),
    fs
      .stat(siteConfigPath)
      .then((stats) => stats.isFile())
      .catch(() => false),
  ]);

  return hasContentDir && hasSiteConfig;
};

const ensureInsideRoot = ({ rootDir, resolvedPath }) => {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedResolved = path.resolve(resolvedPath);

  if (
    normalizedResolved !== normalizedRoot &&
    !normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error(`Resolved path escapes the content source root: ${normalizedResolved}`);
  }

  return normalizedResolved;
};

const assertContentRelativePath = (value, pattern = IMAGE_PATH_PATTERN) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  if (!pattern.test(normalized)) {
    throw new Error(`Invalid content-relative path: ${value}`);
  }
  return normalized;
};

const enumerateFiles = async (rootDir, results = []) => {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const nextPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await enumerateFiles(nextPath, results);
      continue;
    }

    results.push(nextPath);
  }

  return results;
};

const readJsonIfExists = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

/**
 * @param {{ rawSource?: string | null, projectRoot?: string }} options
 */
const resolveLocalContentSource = async ({ rawSource, projectRoot = process.cwd() }) => {
  if (!rawSource || !isLocalPathLike(rawSource)) {
    return null;
  }

  const sourceRoot = path.resolve(projectRoot, rawSource);

  const hasRepoShape = await hasRequiredCourseRepoShape(sourceRoot);
  if (!hasRepoShape) {
    return null;
  }

  return {
    sourceRoot,
    relativePath: normalizePosixPath(path.relative(projectRoot, sourceRoot)),
  };
};

const listSuggestedLocalSources = async ({ configuredSource, projectRoot }) => {
  const suggestions = new Set();

  const githubMatch = /^github:[^/]+\/([^#]+?)(?:#.+)?$/iu.exec(configuredSource ?? "");
  if (githubMatch?.[1]) {
    suggestions.add(normalizePosixPath(path.join("..", githubMatch[1])));
  }

  const workspaceRoot = path.resolve(projectRoot, "..");
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidateRoot = path.join(workspaceRoot, entry.name);
    if (!(await hasRequiredCourseRepoShape(candidateRoot))) {
      continue;
    }

    suggestions.add(normalizePosixPath(path.relative(projectRoot, candidateRoot)));
  }

  return [...suggestions].sort((left, right) => left.localeCompare(right));
};

const resolveSourcePath = ({ sourceRoot, contentRelativePath, pattern }) => {
  const normalized = assertContentRelativePath(contentRelativePath, pattern);
  return ensureInsideRoot({
    rootDir: sourceRoot,
    resolvedPath: path.resolve(sourceRoot, normalized),
  });
};

const ensureParentDir = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const rewritePageSourceForDevRefresh = async ({ pageAbsPath, sourceText }) => {
  // Rewriting the page with identical contents makes the synced MDX page update
  // after the generated image file, so the open dev preview reloads the latest image.
  await fs.writeFile(pageAbsPath, sourceText, "utf8");
};

const hydrateManifest = (manifestInput) => {
  const normalized = normalizeTutorialShotManifest(manifestInput);
  const defaults = createDefaultTutorialShotManifest({
    pagePath: normalized.pagePath,
    outputImagePath: normalized.outputImagePath,
  });

  return {
    ...normalized,
    id: defaults.id,
    rawImagePath: defaults.rawImagePath,
    version: defaults.version,
  };
};

const prepareManifestForSave = (manifestInput) => ({
  ...hydrateManifest(manifestInput),
  updatedAt: new Date().toISOString(),
});

const parseDataUrl = (value) => {
  const match = /^data:([^;,]+)?;base64,(.+)$/u.exec(value ?? "");
  if (!match) {
    throw new Error("アップロード画像の形式が不正です。");
  }

  return {
    mimeType: match[1] ?? "application/octet-stream",
    buffer: Buffer.from(match[2], "base64"),
  };
};

const normalizeCrop = ({ crop, width, height }) => {
  if (!crop) {
    return { x: 0, y: 0, width, height };
  }

  const x = Math.min(Math.max(0, crop.x), Math.max(0, width - 1));
  const y = Math.min(Math.max(0, crop.y), Math.max(0, height - 1));
  const extractedWidth = Math.min(Math.max(1, crop.width), width - x);
  const extractedHeight = Math.min(Math.max(1, crop.height), height - y);

  return {
    x,
    y,
    width: extractedWidth,
    height: extractedHeight,
  };
};

/**
 * @param {{ env?: NodeJS.ProcessEnv, projectRoot?: string, requestedSource?: string | null }} options
 */
export const getTutorialShotAuthoringContext = async ({
  env = process.env,
  projectRoot = process.cwd(),
  requestedSource = null,
} = {}) => {
  const configuredSource =
    typeof env.COURSE_CONTENT_SOURCE === "string" ? env.COURSE_CONTENT_SOURCE.trim() : "";
  const overrideSource =
    typeof requestedSource === "string" && requestedSource.trim() ? requestedSource.trim() : null;
  const suggestedLocalSources = await listSuggestedLocalSources({
    configuredSource,
    projectRoot,
  });

  if (overrideSource) {
    const resolvedOverride = await resolveLocalContentSource({
      rawSource: overrideSource,
      projectRoot,
    });

    if (!resolvedOverride) {
      return {
        enabled: false,
        reason:
          "そのローカル教材 repo は開けませんでした。content/ と site.config.ts があるパスを指定してください。",
        configuredSource: configuredSource || null,
        suggestedLocalSources,
        overrideSource,
      };
    }

    return {
      enabled: true,
      sourceRoot: resolvedOverride.sourceRoot,
      activeSourcePath: overrideSource,
      sourceKind: "override",
      configuredSource: configuredSource || null,
      suggestedLocalSources,
    };
  }

  const resolvedConfiguredSource = await resolveLocalContentSource({
    rawSource: configuredSource,
    projectRoot,
  });
  if (!resolvedConfiguredSource) {
    const reason = configuredSource
      ? "チュートリアル画像エディタを使うには、書き込み可能なローカル教材 repo が必要です。現在の COURSE_CONTENT_SOURCE はローカルパスではありません。"
      : "チュートリアル画像エディタを使うには、書き込み可能なローカル教材 repo が必要です。COURSE_CONTENT_SOURCE にローカルパスが設定されていません。";

    return {
      enabled: false,
      reason,
      configuredSource: configuredSource || null,
      suggestedLocalSources,
      overrideSource: null,
    };
  }

  return {
    enabled: true,
    sourceRoot: resolvedConfiguredSource.sourceRoot,
    activeSourcePath: configuredSource,
    sourceKind: "env",
    configuredSource: configuredSource || null,
    suggestedLocalSources,
  };
};

export const scanTutorialShots = async ({ sourceRoot }) => {
  const contentRoot = path.join(sourceRoot, "content");
  const allFiles = await enumerateFiles(contentRoot);
  const pageFiles = allFiles.filter((filePath) => {
    const relativePath = normalizePosixPath(path.relative(sourceRoot, filePath));
    return PAGE_PATH_PATTERN.test(relativePath);
  });
  const shots = [];

  for (const filePath of pageFiles) {
    const relativePath = normalizePosixPath(path.relative(sourceRoot, filePath));
    const sourceText = await fs.readFile(filePath, "utf8");
    const pageModeWarnings = getTutorialPageModeWarnings({ sourceText });
    const refs = [
      ...extractActionImageRefsFromMdx({ pagePath: relativePath, sourceText }).map((ref) => ({
        ...ref,
        shotSource: "action",
      })),
      ...extractVerifyImageRefsFromMdx({ pagePath: relativePath, sourceText }).map((ref) => ({
        ...ref,
        shotSource: "verify",
      })),
    ];

    for (const ref of refs) {
      const manifestPath = resolveSourcePath({
        sourceRoot,
        contentRelativePath: ref.manifestPath,
        pattern: /^content\/.+\/shots\/.+\.shot\.json$/iu,
      });
      const rawImagePath = resolveSourcePath({
        sourceRoot,
        contentRelativePath: ref.rawImagePath,
        pattern: /^content\/.+\/shots\/.+\.(png|jpe?g|webp)$/iu,
      });
      const outputImagePath = resolveSourcePath({
        sourceRoot,
        contentRelativePath: ref.outputImagePath,
        pattern: IMAGE_PATH_PATTERN,
      });

      const rawManifest = await readJsonIfExists(manifestPath);
      const manifest = hydrateManifest(
        rawManifest ??
          createDefaultTutorialShotManifest({
            pagePath: ref.pagePath,
            outputImagePath: ref.outputImagePath,
          }),
      );

      const warnings = getTutorialShotWarnings(manifest, { shotSource: ref.shotSource });
      const mergedWarnings = [...new Set([...pageModeWarnings, ...warnings])];
      const hasManifest = rawManifest !== null;
      const hasRawImage = await fs
        .stat(rawImagePath)
        .then(() => true)
        .catch(() => false);
      const hasOutputImage = await fs
        .stat(outputImagePath)
        .then(() => true)
        .catch(() => false);

      shots.push({
        ...ref,
        manifest,
        warnings: mergedWarnings,
        hasManifest,
        hasRawImage,
        hasOutputImage,
      });
    }
  }

  return shots.sort((left, right) => {
    if (left.pagePath !== right.pagePath) {
      return left.pagePath.localeCompare(right.pagePath);
    }
    return left.line - right.line;
  });
};

export const saveTutorialShot = async ({
  sourceRoot,
  manifestInput,
  rawImageDataUrl = null,
  bootstrapFromOutput = false,
}) => {
  const manifest = prepareManifestForSave(manifestInput);
  const annotationErrors = getTutorialShotAnnotationErrors(manifest.annotations, manifest.annotationMode);
  if (annotationErrors.length > 0) {
    throw new Error(annotationErrors[0]);
  }

  if (!PAGE_PATH_PATTERN.test(manifest.pagePath)) {
    throw new Error(`不正なチュートリアル画像ページパスです: ${manifest.pagePath}`);
  }

  const outputAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: manifest.outputImagePath,
    pattern: IMAGE_PATH_PATTERN,
  });
  const rawAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: manifest.rawImagePath,
    pattern: /^content\/.+\/shots\/.+\.(png|jpe?g|webp)$/iu,
  });
  const derivedPaths = deriveTutorialShotPaths({
    pagePath: manifest.pagePath,
    outputImagePath: manifest.outputImagePath,
  });
  const manifestAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: derivedPaths.manifestPath,
    pattern: /^content\/.+\/shots\/.+\.shot\.json$/iu,
  });
  const pageAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: manifest.pagePath,
    pattern: PAGE_PATH_PATTERN,
  });

  if (rawImageDataUrl) {
    const { buffer } = parseDataUrl(rawImageDataUrl);
    await ensureParentDir(rawAbsPath);
    await fs.writeFile(rawAbsPath, buffer);
  } else if (bootstrapFromOutput) {
    const outputExists = await fs
      .stat(outputAbsPath)
      .then(() => true)
      .catch(() => false);
    if (!outputExists) {
      throw new Error(
        "現在の出力画像が無いため、そこから元画像を初期作成できません。先に元画像をアップロードしてください。",
      );
    }
    await ensureParentDir(rawAbsPath);
    await fs.copyFile(outputAbsPath, rawAbsPath);
  }

  const rawExists = await fs
    .stat(rawAbsPath)
    .then(() => true)
    .catch(() => false);
  if (!rawExists) {
    throw new Error(
      "元画像がまだ無いため、この Action 画像は保存できません。先に元画像をアップロードしてください。",
    );
  }

  const rawBuffer = await fs.readFile(rawAbsPath);
  const rawImage = sharp(rawBuffer);
  const metadata = await rawImage.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`元画像のサイズを取得できませんでした: ${manifest.rawImagePath}`);
  }

  const crop = normalizeCrop({
    crop: manifest.crop,
    width: metadata.width,
    height: metadata.height,
  });
  const outputLayout = getTutorialShotCanvasLayout({
    imageWidth: crop.width,
    imageHeight: crop.height,
    annotations: manifest.annotations,
    annotationMode: manifest.annotationMode,
  });
  const overlaySvg = renderTutorialShotOverlaySvg({
    width: outputLayout.width,
    height: outputLayout.height,
    annotations: manifest.annotations,
    annotationMode: manifest.annotationMode,
    offsetX: outputLayout.imageX,
    offsetY: outputLayout.imageY,
  });
  const croppedImageBuffer = await rawImage
    .clone()
    .extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    })
    .png()
    .toBuffer();

  await ensureParentDir(outputAbsPath);
  await sharp({
    create: {
      width: outputLayout.width,
      height: outputLayout.height,
      channels: 4,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    },
  })
    .composite([
      {
        input: croppedImageBuffer,
        left: outputLayout.imageX,
        top: outputLayout.imageY,
      },
      { input: Buffer.from(overlaySvg, "utf8") },
    ])
    .png()
    .toFile(outputAbsPath);

  const savedManifest = {
    ...manifest,
    crop,
  };

  await ensureParentDir(manifestAbsPath);
  await fs.writeFile(manifestAbsPath, `${JSON.stringify(savedManifest, null, 2)}\n`, "utf8");

  const pageSourceText = await fs.readFile(pageAbsPath, "utf8");
  await rewritePageSourceForDevRefresh({
    pageAbsPath,
    sourceText: pageSourceText,
  });
  const pageModeWarnings = getTutorialPageModeWarnings({ sourceText: pageSourceText });

  return {
    manifest: savedManifest,
    warnings: [...new Set([...pageModeWarnings, ...getTutorialShotWarnings(savedManifest)])],
  };
};

export const readTutorialShotImage = async ({ sourceRoot, contentRelativePath }) => {
  const absolutePath = resolveSourcePath({
    sourceRoot,
    contentRelativePath,
    pattern: /^content\/.+\.(png|jpe?g|webp)$/iu,
  });

  const bytes = await fs.readFile(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const contentType =
    extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : "image/png";

  return {
    bytes,
    contentType,
  };
};

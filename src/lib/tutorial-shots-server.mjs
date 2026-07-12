import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createDefaultTutorialShotManifest,
  deriveTutorialShotRawImagePath,
  deriveTutorialShotPaths,
  extractActionImageRefsFromMdx,
  extractVerifyImageRefsFromMdx,
  getTutorialShotFileExtension,
  getTutorialShotAnnotationErrors,
  getTutorialShotCanvasLayout,
  getTutorialShotGeneratedImageFormat,
  getTutorialShotImageContentType,
  getTutorialShotSourceImageExtensionForFileName,
  getTutorialShotSourceImageExtensionForMimeType,
  getTutorialShotWarnings,
  isExpectedTutorialShotRawImagePath,
  isTutorialShotManifestPath,
  isTutorialShotOutputImagePath,
  isTutorialShotReadableImagePath,
  normalizeDecodedPosixPath,
  normalizePosixPath,
  normalizeTutorialShotManifest,
  replaceTutorialShotPathExtension,
  renderTutorialShotOverlaySvg,
  isTutorialShotSourceImageMimeType,
  rewriteTutorialShotImageRefsForOutputPolicy,
} from "./tutorial-shots-shared.mjs";

const PAGE_PATH_PATTERN = /^content\/.+\/index\.mdx?$/iu;
const MAX_RAW_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
const SHARP_INPUT_PIXEL_LIMIT = 100_000_000;
const ANIMATED_GENERATED_WEBP_SOURCE_FORMATS = new Set(["webp"]);
const SHARP_RAW_UPLOAD_FORMAT_EXTENSIONS = new Map([
  ["png", new Set([".png", ".apng"])],
  ["jpeg", new Set([".jpg", ".jpeg", ".jfif", ".jpe", ".jif"])],
  ["webp", new Set([".webp"])],
  ["gif", new Set([".gif"])],
  ["avif", new Set([".avif"])],
  ["heif", new Set([".avif"])],
  ["svg", new Set([".svg"])],
  ["bmp", new Set([".bmp", ".dib"])],
]);

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

const assertContentRelativePath = (value, validator = isTutorialShotOutputImagePath) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  const isValid =
    typeof validator === "function" ? validator(normalized) : validator.test(normalized);
  if (!isValid) {
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

const resolveSourcePath = ({ sourceRoot, contentRelativePath, validator }) => {
  const normalized = assertContentRelativePath(contentRelativePath, validator);
  return ensureInsideRoot({
    rootDir: sourceRoot,
    resolvedPath: path.resolve(sourceRoot, normalized),
  });
};

const ensureParentDir = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const rewritePageSourceForDevRefresh = async ({
  pageAbsPath,
  pagePath,
  sourceText,
  outputImagePath,
}) => {
  // Rewriting the page with identical contents makes the synced MDX page update
  // after the generated image file, so the open dev preview reloads the latest image.
  const rewrite = rewriteTutorialShotImageRefsForOutputPolicy({
    pagePath,
    sourceText,
    outputImagePath,
  });
  await fs.writeFile(pageAbsPath, rewrite.sourceText, "utf8");
  return rewrite.sourceText;
};

const hydrateManifest = (manifestInput) => {
  const normalized = normalizeTutorialShotManifest(manifestInput);
  const defaults = createDefaultTutorialShotManifest({
    pagePath: normalized.pagePath,
    outputImagePath: normalized.outputImagePath,
  });
  const rawImagePath = isExpectedTutorialShotRawImagePath({
    pagePath: normalized.pagePath,
    outputImagePath: defaults.outputImagePath,
    rawImagePath: normalized.rawImagePath,
  })
    ? normalized.rawImagePath
    : defaults.rawImagePath;

  return {
    ...normalized,
    id: defaults.id,
    outputImagePath: defaults.outputImagePath,
    rawImagePath,
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

  const mimeType = match[1] ?? "application/octet-stream";
  if (!isTutorialShotSourceImageMimeType(mimeType)) {
    throw new Error("アップロード画像の形式が対応していません。");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > MAX_RAW_IMAGE_UPLOAD_BYTES) {
    throw new Error("アップロード画像が大きすぎます。25MB 以下の画像を選んでください。");
  }

  return {
    mimeType,
    buffer,
  };
};

const createSharpInputImage = (input, options = {}) =>
  sharp(input, { ...options, limitInputPixels: SHARP_INPUT_PIXEL_LIMIT });

const validateUploadedRawImageBuffer = async ({ buffer }) => {
  const sourceImage = createSharpInputImage(buffer);
  const metadata = await sourceImage.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("アップロード画像のサイズを取得できませんでした。");
  }
  const acceptedExtensions = metadata.format
    ? SHARP_RAW_UPLOAD_FORMAT_EXTENSIONS.get(metadata.format)
    : null;
  if (!acceptedExtensions) {
    throw new Error("アップロード画像の形式が対応していません。");
  }

  return metadata;
};

const isAnimatedGeneratedWebpSourceMetadata = (metadata) =>
  ANIMATED_GENERATED_WEBP_SOURCE_FORMATS.has(metadata?.format) &&
  Number.isInteger(metadata?.pages) &&
  metadata.pages > 1 &&
  Number.isInteger(metadata?.pageHeight) &&
  metadata.pageHeight > 0;

const getRawImageProcessingContext = async ({ rawBuffer }) => {
  const animatedMetadata = await createSharpInputImage(rawBuffer, { animated: true }).metadata();
  if (isAnimatedGeneratedWebpSourceMetadata(animatedMetadata)) {
    return {
      frameHeight: animatedMetadata.pageHeight,
      image: createSharpInputImage(rawBuffer, { animated: true }),
      metadata: animatedMetadata,
      preserveAnimation: true,
    };
  }

  const image = createSharpInputImage(rawBuffer);
  const metadata = await image.metadata();

  return {
    frameHeight: metadata.height,
    image,
    metadata,
    preserveAnimation: false,
  };
};

const getRawUploadExtensionForMetadata = ({
  metadataFormat,
  mimeType,
  rawImageFileName,
  manifestRawImagePath,
}) => {
  const acceptedExtensions = SHARP_RAW_UPLOAD_FORMAT_EXTENSIONS.get(metadataFormat) ?? null;
  if (!acceptedExtensions) {
    throw new Error("アップロード画像の形式が対応していません。");
  }

  const manifestExtension = getTutorialShotFileExtension(manifestRawImagePath);
  if (acceptedExtensions.has(manifestExtension)) {
    return manifestExtension;
  }

  const fileNameExtension = getTutorialShotSourceImageExtensionForFileName(rawImageFileName);
  if (acceptedExtensions.has(fileNameExtension)) {
    return fileNameExtension;
  }

  const mimeExtension = getTutorialShotSourceImageExtensionForMimeType(mimeType);
  if (acceptedExtensions.has(mimeExtension)) {
    return mimeExtension;
  }

  return [...acceptedExtensions][0];
};

const writeGeneratedTutorialShotImage = async ({ image, outputAbsPath, outputFormat }) => {
  if (!outputFormat) {
    throw new Error(`出力画像の形式が対応していません: ${outputAbsPath}`);
  }

  if (outputFormat.sharpFormat === "webp-lossless") {
    await image.webp({ lossless: true }).toFile(outputAbsPath);
    return;
  }

  if (outputFormat.sharpFormat === "png") {
    await image.png().toFile(outputAbsPath);
    return;
  }

  if (outputFormat.sharpFormat === "jpeg") {
    await image.jpeg().toFile(outputAbsPath);
    return;
  }

  throw new Error(`出力画像の形式が対応していません: ${outputAbsPath}`);
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

const getTutorialShotAnimatedOutputPlan = ({ metadata, outputFormat }) => {
  const pages = Number.isInteger(metadata.pages) ? metadata.pages : 1;
  if (pages <= 1) {
    return null;
  }

  if (
    !ANIMATED_GENERATED_WEBP_SOURCE_FORMATS.has(metadata.format) ||
    outputFormat?.sharpFormat !== "webp-lossless"
  ) {
    return null;
  }

  return {
    delay: Array.isArray(metadata.delay) && metadata.delay.length > 0 ? metadata.delay : undefined,
    loop: Number.isInteger(metadata.loop) ? metadata.loop : undefined,
    pages,
  };
};

const getRepeatedOverlayComposites = ({ overlaySvg, pages, pageHeight }) =>
  Array.from({ length: pages }, (_, index) => ({
    input: Buffer.from(overlaySvg, "utf8"),
    left: 0,
    top: index * pageHeight,
  }));

const writeAnimatedWebpTutorialShotImage = async ({
  rawBuffer,
  crop,
  outputLayout,
  overlaySvg,
  outputAbsPath,
  animatedOutputPlan,
}) => {
  const webpOptions = { lossless: true };
  if (animatedOutputPlan.delay) {
    webpOptions.delay = animatedOutputPlan.delay;
  }
  if (animatedOutputPlan.loop !== undefined) {
    webpOptions.loop = animatedOutputPlan.loop;
  }

  await sharp(rawBuffer, { animated: true, limitInputPixels: SHARP_INPUT_PIXEL_LIMIT })
    .extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    })
    .extend({
      left: outputLayout.imageX,
      top: outputLayout.imageY,
      right: outputLayout.width - outputLayout.imageX - crop.width,
      bottom: outputLayout.height - outputLayout.imageY - crop.height,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    })
    .composite(
      getRepeatedOverlayComposites({
        overlaySvg,
        pages: animatedOutputPlan.pages,
        pageHeight: outputLayout.height,
      }),
    )
    .webp(webpOptions)
    .toFile(outputAbsPath);
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
        validator: isTutorialShotManifestPath,
      });
      const outputImagePath = resolveSourcePath({
        sourceRoot,
        contentRelativePath: ref.outputImagePath,
        validator: isTutorialShotOutputImagePath,
      });
      const referencedImagePath = resolveSourcePath({
        sourceRoot,
        contentRelativePath: ref.referencedImagePath,
        validator: isTutorialShotReadableImagePath,
      });

      const rawManifest = await readJsonIfExists(manifestPath);
      const manifest = hydrateManifest(
        rawManifest
          ? {
              ...rawManifest,
              pagePath: ref.pagePath,
              outputImagePath: ref.outputImagePath,
            }
          : createDefaultTutorialShotManifest({
              pagePath: ref.pagePath,
              outputImagePath: ref.outputImagePath,
            }),
      );
      const rawImagePath = resolveSourcePath({
        sourceRoot,
        contentRelativePath: manifest.rawImagePath,
        validator: (contentPath) =>
          isExpectedTutorialShotRawImagePath({
            pagePath: manifest.pagePath,
            outputImagePath: manifest.outputImagePath,
            rawImagePath: contentPath,
          }),
      });

      const warnings = getTutorialShotWarnings(manifest, { shotSource: ref.shotSource });
      const hasManifest = rawManifest !== null;
      const hasRawImage = await fs
        .stat(rawImagePath)
        .then(() => true)
        .catch(() => false);
      const hasOutputImage = await fs
        .stat(outputImagePath)
        .then(() => true)
        .catch(() => false);
      const hasReferencedImage =
        ref.referencedImagePath === ref.outputImagePath
          ? hasOutputImage
          : await fs
              .stat(referencedImagePath)
              .then(() => true)
              .catch(() => false);
      const bootstrapImagePath = hasOutputImage
        ? ref.outputImagePath
        : hasReferencedImage
          ? ref.referencedImagePath
          : null;

      shots.push({
        ...ref,
        rawImagePath: manifest.rawImagePath,
        manifest,
        warnings,
        hasManifest,
        hasRawImage,
        hasOutputImage: hasOutputImage || hasReferencedImage,
        bootstrapImagePath,
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
  rawImageFileName = null,
  bootstrapFromOutput = false,
  bootstrapImagePath = null,
}) => {
  let manifest = prepareManifestForSave(manifestInput);
  const annotationErrors = getTutorialShotAnnotationErrors(
    manifest.annotations,
    manifest.annotationMode,
  );
  if (annotationErrors.length > 0) {
    throw new Error(annotationErrors[0]);
  }

  if (!PAGE_PATH_PATTERN.test(manifest.pagePath)) {
    throw new Error(`不正なチュートリアル画像ページパスです: ${manifest.pagePath}`);
  }

  const outputAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: manifest.outputImagePath,
    validator: isTutorialShotOutputImagePath,
  });
  let rawAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: manifest.rawImagePath,
    validator: (contentPath) =>
      isExpectedTutorialShotRawImagePath({
        pagePath: manifest.pagePath,
        outputImagePath: manifest.outputImagePath,
        rawImagePath: contentPath,
      }),
  });
  const derivedPaths = deriveTutorialShotPaths({
    pagePath: manifest.pagePath,
    outputImagePath: manifest.outputImagePath,
  });
  const manifestAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: derivedPaths.manifestPath,
    validator: isTutorialShotManifestPath,
  });
  const pageAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: manifest.pagePath,
    validator: PAGE_PATH_PATTERN,
  });

  if (rawImageDataUrl) {
    const { buffer, mimeType } = parseDataUrl(rawImageDataUrl);
    const metadata = await validateUploadedRawImageBuffer({ buffer });
    const rawExtension = getRawUploadExtensionForMetadata({
      metadataFormat: metadata.format,
      mimeType,
      rawImageFileName,
      manifestRawImagePath: manifest.rawImagePath,
    });
    manifest = {
      ...manifest,
      rawImagePath: deriveTutorialShotRawImagePath({
        pagePath: manifest.pagePath,
        outputImagePath: manifest.outputImagePath,
        fallbackExtension: rawExtension,
      }),
    };
    rawAbsPath = resolveSourcePath({
      sourceRoot,
      contentRelativePath: manifest.rawImagePath,
      validator: (contentPath) =>
        isExpectedTutorialShotRawImagePath({
          pagePath: manifest.pagePath,
          outputImagePath: manifest.outputImagePath,
          rawImagePath: contentPath,
        }),
    });
    await ensureParentDir(rawAbsPath);
    await fs.writeFile(rawAbsPath, buffer);
  } else if (bootstrapFromOutput) {
    let bootstrapContentPath = normalizeDecodedPosixPath(
      typeof bootstrapImagePath === "string" && bootstrapImagePath.trim()
        ? bootstrapImagePath
        : manifest.outputImagePath,
    );
    let bootstrapDerivedPaths = deriveTutorialShotPaths({
      pagePath: manifest.pagePath,
      outputImagePath: bootstrapContentPath,
    });
    if (bootstrapDerivedPaths.id !== manifest.id) {
      throw new Error("現在の出力画像と保存対象のショットが一致しません。");
    }
    let bootstrapAbsPath = resolveSourcePath({
      sourceRoot,
      contentRelativePath: bootstrapContentPath,
      validator: isTutorialShotReadableImagePath,
    });
    let bootstrapImageExists = await fs
      .stat(bootstrapAbsPath)
      .then(() => true)
      .catch(() => false);
    if (
      !bootstrapImageExists &&
      !(typeof bootstrapImagePath === "string" && bootstrapImagePath.trim())
    ) {
      const legacyExtension = getTutorialShotFileExtension(manifest.rawImagePath);
      const legacyContentPath = legacyExtension
        ? replaceTutorialShotPathExtension(manifest.outputImagePath, legacyExtension)
        : manifest.outputImagePath;
      if (legacyContentPath !== manifest.outputImagePath) {
        bootstrapContentPath = legacyContentPath;
        bootstrapDerivedPaths = deriveTutorialShotPaths({
          pagePath: manifest.pagePath,
          outputImagePath: bootstrapContentPath,
        });
        if (bootstrapDerivedPaths.id !== manifest.id) {
          throw new Error("現在の出力画像と保存対象のショットが一致しません。");
        }
        bootstrapAbsPath = resolveSourcePath({
          sourceRoot,
          contentRelativePath: bootstrapContentPath,
          validator: isTutorialShotReadableImagePath,
        });
        bootstrapImageExists = await fs
          .stat(bootstrapAbsPath)
          .then(() => true)
          .catch(() => false);
      }
    }
    manifest = {
      ...manifest,
      rawImagePath: deriveTutorialShotRawImagePath({
        pagePath: manifest.pagePath,
        outputImagePath: manifest.outputImagePath,
        fallbackExtension: getTutorialShotFileExtension(bootstrapContentPath),
      }),
    };
    rawAbsPath = resolveSourcePath({
      sourceRoot,
      contentRelativePath: manifest.rawImagePath,
      validator: (contentPath) =>
        isExpectedTutorialShotRawImagePath({
          pagePath: manifest.pagePath,
          outputImagePath: manifest.outputImagePath,
          rawImagePath: contentPath,
        }),
    });
    if (!bootstrapImageExists) {
      throw new Error(
        "現在の出力画像が無いため、そこから元画像を初期作成できません。先に元画像をアップロードしてください。",
      );
    }
    await ensureParentDir(rawAbsPath);
    await fs.copyFile(bootstrapAbsPath, rawAbsPath);
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
  const outputFormat = getTutorialShotGeneratedImageFormat(manifest.outputImagePath);
  const rawImageContext = await getRawImageProcessingContext({ rawBuffer });
  const { image: rawImage, metadata } = rawImageContext;

  if (!metadata.width || !rawImageContext.frameHeight) {
    throw new Error(`元画像のサイズを取得できませんでした: ${manifest.rawImagePath}`);
  }

  const animatedOutputPlan = rawImageContext.preserveAnimation
    ? getTutorialShotAnimatedOutputPlan({ metadata, outputFormat })
    : null;

  const crop = normalizeCrop({
    crop: manifest.crop,
    width: metadata.width,
    height: rawImageContext.frameHeight,
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

  await ensureParentDir(outputAbsPath);
  if (animatedOutputPlan) {
    await writeAnimatedWebpTutorialShotImage({
      rawBuffer,
      crop,
      outputLayout,
      overlaySvg,
      outputAbsPath,
      animatedOutputPlan,
    });
  } else {
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
    const generatedImage = sharp({
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
    }).composite([
      {
        input: croppedImageBuffer,
        left: outputLayout.imageX,
        top: outputLayout.imageY,
      },
      { input: Buffer.from(overlaySvg, "utf8") },
    ]);
    await writeGeneratedTutorialShotImage({
      image: generatedImage,
      outputAbsPath,
      outputFormat,
    });
  }

  const savedManifest = {
    ...manifest,
    crop,
  };

  await ensureParentDir(manifestAbsPath);
  await fs.writeFile(manifestAbsPath, `${JSON.stringify(savedManifest, null, 2)}\n`, "utf8");

  const pageSourceText = await fs.readFile(pageAbsPath, "utf8");
  await rewritePageSourceForDevRefresh({
    pageAbsPath,
    pagePath: manifest.pagePath,
    sourceText: pageSourceText,
    outputImagePath: manifest.outputImagePath,
  });

  return {
    manifest: savedManifest,
    warnings: getTutorialShotWarnings(savedManifest),
  };
};

export const readTutorialShotImage = async ({ sourceRoot, contentRelativePath }) => {
  const absolutePath = resolveSourcePath({
    sourceRoot,
    contentRelativePath,
    validator: isTutorialShotReadableImagePath,
  });

  const bytes = await fs.readFile(absolutePath);
  const contentType = getTutorialShotImageContentType(absolutePath);
  if (!contentType) {
    throw new Error(`画像の MIME type を決定できませんでした: ${contentRelativePath}`);
  }

  return {
    bytes,
    contentType,
  };
};

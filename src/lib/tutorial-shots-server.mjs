import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  getTutorialShotPageRelativeOutputImagePath,
  getTutorialShotSourceImageExtensionForFileName,
  getTutorialShotSourceImageExtensionForMimeType,
  getTutorialShotWarnings,
  isExpectedTutorialShotRawImagePath,
  isTutorialShotManifestPath,
  isTutorialShotOutputImagePath,
  isTutorialShotRawImagePath,
  isTutorialShotReadableImagePath,
  normalizeDecodedPosixPath,
  normalizePosixPath,
  normalizeTutorialShotManifest,
  replaceTutorialShotPathExtension,
  renderTutorialShotOverlaySvg,
  isTutorialShotSourceImageMimeType,
  TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS,
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
const TUTORIAL_SHOT_RAW_IMAGE_EXTENSIONS = [
  ...new Set(TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS.flatMap((format) => format.extensions)),
];

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

const isTutorialShotArtifactPath = (contentPath) =>
  isTutorialShotOutputImagePath(contentPath) ||
  isTutorialShotManifestPath(contentPath) ||
  isTutorialShotRawImagePath(contentPath);

export const getTutorialShotArtifactPaths = (ref) => {
  const requestedOutputImagePath = ref.referencedImagePath ?? ref.outputImagePath;
  const derived = deriveTutorialShotPaths({
    pagePath: ref.pagePath,
    outputImagePath: requestedOutputImagePath,
    rawImageExtension: getTutorialShotFileExtension(ref.rawImagePath ?? requestedOutputImagePath),
  });
  const rawImagePath = isExpectedTutorialShotRawImagePath({
    pagePath: ref.pagePath,
    outputImagePath: derived.outputImagePath,
    rawImagePath: ref.rawImagePath,
  })
    ? normalizeDecodedPosixPath(ref.rawImagePath)
    : derived.rawImagePath;

  return {
    outputImagePath: derived.outputImagePath,
    manifestPath: derived.manifestPath,
    rawImagePath,
  };
};

export const getTutorialShotArtifactIdentity = ({
  sourceRoot,
  contentRelativePath,
  platform = process.platform,
}) => {
  const absolutePath = resolveSourcePath({
    sourceRoot,
    contentRelativePath,
    validator: isTutorialShotArtifactPath,
  });
  return platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
};

const getFileSystemPathIdentity = ({ sourceRoot, absolutePath, platform = process.platform }) => {
  const insideRootPath = ensureInsideRoot({ rootDir: sourceRoot, resolvedPath: absolutePath });
  return platform === "win32" ? insideRootPath.toLowerCase() : insideRootPath;
};

const tutorialShotArtifactPathsShareArtifacts = ({
  sourceRoot,
  leftPaths,
  rightPaths,
  platform = process.platform,
}) => {
  const leftIdentities = new Set(
    Object.values(leftPaths).map((contentRelativePath) =>
      getTutorialShotArtifactIdentity({ sourceRoot, contentRelativePath, platform }),
    ),
  );
  return Object.values(rightPaths).some((contentRelativePath) =>
    leftIdentities.has(
      getTutorialShotArtifactIdentity({ sourceRoot, contentRelativePath, platform }),
    ),
  );
};

export const tutorialShotRefsShareArtifacts = ({
  sourceRoot,
  left,
  right,
  platform = process.platform,
}) =>
  tutorialShotArtifactPathsShareArtifacts({
    sourceRoot,
    leftPaths: getTutorialShotArtifactPaths(left),
    rightPaths: getTutorialShotArtifactPaths(right),
    platform,
  });

const ensureParentDir = async (filePath, fileOps = fs) => {
  await fileOps.mkdir(path.dirname(filePath), { recursive: true });
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

const renderGeneratedTutorialShotImage = async ({ image, outputImagePath, outputFormat }) => {
  if (!outputFormat) {
    throw new Error(`出力画像の形式が対応していません: ${outputImagePath}`);
  }

  if (outputFormat.sharpFormat === "webp-lossless") {
    return image.webp({ lossless: true }).toBuffer();
  }

  if (outputFormat.sharpFormat === "png") {
    return image.png().toBuffer();
  }

  if (outputFormat.sharpFormat === "jpeg") {
    return image.jpeg().toBuffer();
  }

  throw new Error(`出力画像の形式が対応していません: ${outputImagePath}`);
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

const renderAnimatedWebpTutorialShotImage = async ({
  rawBuffer,
  crop,
  outputLayout,
  overlaySvg,
  animatedOutputPlan,
}) => {
  const webpOptions = { lossless: true };
  if (animatedOutputPlan.delay) {
    webpOptions.delay = animatedOutputPlan.delay;
  }
  if (animatedOutputPlan.loop !== undefined) {
    webpOptions.loop = animatedOutputPlan.loop;
  }

  return sharp(rawBuffer, { animated: true, limitInputPixels: SHARP_INPUT_PIXEL_LIMIT })
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
    .toBuffer();
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

const hashTutorialShotText = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const createTutorialShotReferenceKey = ({ pagePath, pageRevision, tagName, tagStart, tagEnd }) =>
  hashTutorialShotText(
    JSON.stringify([pagePath, pageRevision, tagName, Number(tagStart), Number(tagEnd)]),
  );

const extractTutorialShotSourceRefs = ({ pagePath, sourceText }) => {
  const pageRevision = hashTutorialShotText(sourceText);
  return [
    ...extractActionImageRefsFromMdx({ pagePath, sourceText }).map((ref) => ({
      ...ref,
      shotSource: "action",
    })),
    ...extractVerifyImageRefsFromMdx({ pagePath, sourceText }).map((ref) => ({
      ...ref,
      shotSource: "verify",
    })),
  ].map((ref) => ({
    ...ref,
    pageRevision,
    referenceKey: createTutorialShotReferenceKey({ ...ref, pageRevision }),
  }));
};

const scanTutorialShotSourceState = async ({ sourceRoot }) => {
  const contentRoot = path.join(sourceRoot, "content");
  const allFiles = await enumerateFiles(contentRoot);
  const pageFiles = allFiles.filter((filePath) => {
    const relativePath = normalizePosixPath(path.relative(sourceRoot, filePath));
    return PAGE_PATH_PATTERN.test(relativePath);
  });
  const pages = new Map();
  const refs = [];

  for (const filePath of pageFiles) {
    const relativePath = normalizePosixPath(path.relative(sourceRoot, filePath));
    const sourceText = await fs.readFile(filePath, "utf8");
    const pageRevision = hashTutorialShotText(sourceText);
    pages.set(relativePath, { absolutePath: filePath, pageRevision, sourceText });
    refs.push(...extractTutorialShotSourceRefs({ pagePath: relativePath, sourceText }));
  }

  refs.sort((left, right) => {
    if (left.pagePath !== right.pagePath) {
      return left.pagePath.localeCompare(right.pagePath);
    }
    return left.tagStart - right.tagStart;
  });

  const artifactPathsByReferenceKey = new Map();
  for (const ref of refs) {
    const defaultArtifactPaths = getTutorialShotArtifactPaths(ref);
    const manifestAbsolutePath = resolveSourcePath({
      sourceRoot,
      contentRelativePath: defaultArtifactPaths.manifestPath,
      validator: isTutorialShotManifestPath,
    });
    const rawManifest = await readJsonIfExists(manifestAbsolutePath);
    const manifest = hydrateManifest(
      rawManifest
        ? {
            ...rawManifest,
            pagePath: ref.pagePath,
            outputImagePath: defaultArtifactPaths.outputImagePath,
          }
        : createDefaultTutorialShotManifest({
            pagePath: ref.pagePath,
            outputImagePath: defaultArtifactPaths.outputImagePath,
          }),
    );
    artifactPathsByReferenceKey.set(
      ref.referenceKey,
      getTutorialShotArtifactPaths({ ...ref, rawImagePath: manifest.rawImagePath }),
    );
  }

  return {
    allFiles,
    artifactPathsByReferenceKey,
    pages,
    refs,
  };
};

export const scanTutorialShots = async ({ sourceRoot }) => {
  const sourceState = await scanTutorialShotSourceState({ sourceRoot });
  const shots = [];

  for (const ref of sourceState.refs) {
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

  return shots;
};

const SOURCE_REFERENCE_CONFLICT_MESSAGE =
  "教材が更新されています。一覧を再読み込みしてから、もう一度保存してください。";

export class TutorialShotConflictError extends Error {
  constructor(message = SOURCE_REFERENCE_CONFLICT_MESSAGE) {
    super(message);
    this.name = "TutorialShotConflictError";
    this.statusCode = 409;
  }
}

const throwTutorialShotConflict = () => {
  throw new TutorialShotConflictError();
};

const validateTutorialShotSourceRef = ({ sourceState, sourceRef }) => {
  if (!sourceRef || typeof sourceRef !== "object") {
    throwTutorialShotConflict();
  }

  const pagePath = normalizePosixPath(sourceRef.pagePath ?? "");
  if (pagePath !== sourceRef.pagePath || !PAGE_PATH_PATTERN.test(pagePath)) {
    throwTutorialShotConflict();
  }
  if (sourceRef.tagName !== "Action" && sourceRef.tagName !== "Verify") {
    throwTutorialShotConflict();
  }
  for (const field of ["tagStart", "tagEnd", "imgValueStart", "imgValueEnd"]) {
    if (!Number.isSafeInteger(sourceRef[field])) {
      throwTutorialShotConflict();
    }
  }
  if (
    typeof sourceRef.expectedImg !== "string" ||
    typeof sourceRef.pageRevision !== "string" ||
    typeof sourceRef.referenceKey !== "string"
  ) {
    throwTutorialShotConflict();
  }

  const page = sourceState.pages.get(pagePath);
  if (!page || page.pageRevision !== sourceRef.pageRevision) {
    throwTutorialShotConflict();
  }
  if (
    sourceRef.tagStart < 0 ||
    sourceRef.tagEnd <= sourceRef.tagStart ||
    sourceRef.tagEnd > page.sourceText.length ||
    sourceRef.imgValueStart < sourceRef.tagStart ||
    sourceRef.imgValueEnd < sourceRef.imgValueStart ||
    sourceRef.imgValueEnd > sourceRef.tagEnd ||
    page.sourceText.slice(sourceRef.imgValueStart, sourceRef.imgValueEnd) !== sourceRef.expectedImg
  ) {
    throwTutorialShotConflict();
  }

  const expectedReferenceKey = createTutorialShotReferenceKey(sourceRef);
  if (expectedReferenceKey !== sourceRef.referenceKey) {
    throwTutorialShotConflict();
  }

  const currentRef = sourceState.refs.find(
    (ref) =>
      ref.pagePath === pagePath &&
      ref.tagName === sourceRef.tagName &&
      ref.tagStart === sourceRef.tagStart &&
      ref.tagEnd === sourceRef.tagEnd &&
      ref.imgValueStart === sourceRef.imgValueStart &&
      ref.imgValueEnd === sourceRef.imgValueEnd &&
      ref.expectedImg === sourceRef.expectedImg &&
      ref.pageRevision === sourceRef.pageRevision &&
      ref.referenceKey === sourceRef.referenceKey,
  );
  if (!currentRef) {
    throwTutorialShotConflict();
  }

  return { currentRef, page };
};

const assertTutorialShotSourceStateUnchanged = async ({ sourceRoot, sourceState }) => {
  const currentState = await scanTutorialShotSourceState({ sourceRoot });
  if (currentState.pages.size !== sourceState.pages.size) {
    throwTutorialShotConflict();
  }

  for (const [pagePath, page] of sourceState.pages) {
    if (currentState.pages.get(pagePath)?.pageRevision !== page.pageRevision) {
      throwTutorialShotConflict();
    }
  }
};

const resolveExistingFile = async (filePath, fileOps = fs) => {
  try {
    const stats = await fileOps.stat(filePath);
    return stats.isFile();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const allocateBranchedTutorialShotPaths = ({ sourceRoot, sourceState, manifest }) => {
  const outputExtension = path.posix.extname(manifest.outputImagePath);
  const outputStem = manifest.outputImagePath.slice(0, -outputExtension.length);
  const rawExtension = getTutorialShotFileExtension(manifest.rawImagePath);
  const existingArtifactIdentities = new Set(
    sourceState.allFiles.map((absolutePath) =>
      getFileSystemPathIdentity({ sourceRoot, absolutePath }),
    ),
  );
  for (const artifactPaths of sourceState.artifactPathsByReferenceKey.values()) {
    for (const contentRelativePath of Object.values(artifactPaths)) {
      existingArtifactIdentities.add(
        getTutorialShotArtifactIdentity({ sourceRoot, contentRelativePath }),
      );
    }
  }

  for (let attempt = 0; attempt < 128; attempt += 1) {
    const suffix = randomBytes(3).toString("hex");
    const outputImagePath = `${outputStem}--${suffix}${outputExtension}`;
    const derived = deriveTutorialShotPaths({
      pagePath: manifest.pagePath,
      outputImagePath,
      rawImageExtension: rawExtension,
    });
    const rawStem = derived.rawImagePath.slice(
      0,
      derived.rawImagePath.length - getTutorialShotFileExtension(derived.rawImagePath).length,
    );
    const candidatePaths = [
      derived.outputImagePath,
      derived.manifestPath,
      ...TUTORIAL_SHOT_RAW_IMAGE_EXTENSIONS.map((extension) => `${rawStem}${extension}`),
    ];
    const collides = candidatePaths.some((contentRelativePath) =>
      existingArtifactIdentities.has(
        getTutorialShotArtifactIdentity({ sourceRoot, contentRelativePath }),
      ),
    );
    if (!collides) {
      return derived;
    }
  }

  throw new Error("重複しないチュートリアル画像パスを作成できませんでした。");
};

const replaceTutorialShotSourceRef = ({ sourceText, sourceRef, nextImg }) => {
  if (sourceText.slice(sourceRef.imgValueStart, sourceRef.imgValueEnd) !== sourceRef.expectedImg) {
    throwTutorialShotConflict();
  }
  return `${sourceText.slice(0, sourceRef.imgValueStart)}${nextImg}${sourceText.slice(
    sourceRef.imgValueEnd,
  )}`;
};

const createTutorialShotFileOperationError = ({ action, filePath, error }) =>
  new Error(`${action}: ${filePath}: ${error instanceof Error ? error.message : String(error)}`, {
    cause: error,
  });

export const commitTutorialShotFiles = async (entries, { fileOps = fs } = {}) => {
  const transactionId = randomUUID();
  const staged = entries.map((entry, index) => ({
    ...entry,
    backupPath: `${entry.targetPath}.${transactionId}.${index}.bak`,
    backupCreated: false,
    hadTarget: false,
    installed: false,
    restored: false,
    temporaryPath: `${entry.targetPath}.${transactionId}.${index}.tmp`,
    temporaryWritten: false,
  }));

  try {
    for (const entry of staged) {
      await ensureParentDir(entry.targetPath, fileOps);
      entry.temporaryWritten = true;
      await fileOps.writeFile(entry.temporaryPath, entry.data);
    }
    for (const entry of staged) {
      entry.hadTarget = await resolveExistingFile(entry.targetPath, fileOps);
      if (entry.hadTarget) {
        await fileOps.rename(entry.targetPath, entry.backupPath);
        entry.backupCreated = true;
      }
      await fileOps.rename(entry.temporaryPath, entry.targetPath);
      entry.temporaryWritten = false;
      entry.installed = true;
    }
  } catch (operationError) {
    const rollbackErrors = [];
    for (const entry of [...staged].reverse()) {
      if (entry.installed) {
        try {
          await fileOps.rm(entry.targetPath, { force: true });
          entry.installed = false;
        } catch (rollbackError) {
          rollbackErrors.push(
            createTutorialShotFileOperationError({
              action: "設置済みファイルをロールバックできませんでした",
              filePath: entry.targetPath,
              error: rollbackError,
            }),
          );
        }
      }
      if (entry.backupCreated) {
        try {
          await fileOps.rename(entry.backupPath, entry.targetPath);
          entry.backupCreated = false;
          entry.restored = true;
        } catch (rollbackError) {
          rollbackErrors.push(
            createTutorialShotFileOperationError({
              action: "バックアップを復元できませんでした。手動復旧用バックアップを保持します",
              filePath: entry.backupPath,
              error: rollbackError,
            }),
          );
        }
      }
    }

    const cleanupErrors = [];
    for (const entry of staged) {
      if (entry.temporaryWritten) {
        try {
          await fileOps.rm(entry.temporaryPath, { force: true });
          entry.temporaryWritten = false;
        } catch (cleanupError) {
          cleanupErrors.push(
            createTutorialShotFileOperationError({
              action: "ロールバック後の一時ファイルを削除できませんでした",
              filePath: entry.temporaryPath,
              error: cleanupError,
            }),
          );
        }
      }
      if (entry.restored) {
        try {
          await fileOps.rm(entry.backupPath, { force: true });
        } catch (cleanupError) {
          cleanupErrors.push(
            createTutorialShotFileOperationError({
              action: "復元済みバックアップを削除できませんでした",
              filePath: entry.backupPath,
              error: cleanupError,
            }),
          );
        }
      }
    }

    if (rollbackErrors.length > 0 || cleanupErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...rollbackErrors, ...cleanupErrors],
        "チュートリアル画像の保存に失敗し、元のファイル状態を完全には復元できませんでした。",
      );
    }
    throw operationError;
  }

  const cleanupWarnings = [];
  for (const entry of staged) {
    const cleanupPaths = [];
    if (entry.temporaryWritten) {
      cleanupPaths.push({ kind: "一時ファイル", path: entry.temporaryPath });
    }
    if (entry.backupCreated) {
      cleanupPaths.push({ kind: "バックアップ", path: entry.backupPath });
    }
    for (const cleanup of cleanupPaths) {
      try {
        await fileOps.rm(cleanup.path, { force: true });
        if (cleanup.path === entry.temporaryPath) {
          entry.temporaryWritten = false;
        } else {
          entry.backupCreated = false;
        }
      } catch (cleanupError) {
        cleanupWarnings.push(
          `保存は完了しましたが、${cleanup.kind}を削除できませんでした: ${cleanup.path}: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
        );
      }
    }
  }

  return { cleanupWarnings };
};

export const saveTutorialShot = async ({
  sourceRoot,
  sourceRef,
  manifestInput,
  rawImageDataUrl = null,
  rawImageFileName = null,
  bootstrapFromOutput = false,
  bootstrapImagePath = null,
  fileOps = fs,
}) => {
  const sourceState = await scanTutorialShotSourceState({ sourceRoot });
  const { currentRef, page } = validateTutorialShotSourceRef({ sourceState, sourceRef });
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
  const referencedPaths = deriveTutorialShotPaths({
    pagePath: currentRef.pagePath,
    outputImagePath: currentRef.referencedImagePath,
    rawImageExtension: getTutorialShotFileExtension(currentRef.referencedImagePath),
  });
  if (
    manifest.pagePath !== currentRef.pagePath ||
    manifest.outputImagePath !== referencedPaths.outputImagePath
  ) {
    throwTutorialShotConflict();
  }

  const originalManifest = manifest;
  const currentArtifactPaths = getTutorialShotArtifactPaths(manifest);
  const shouldBranch = sourceState.refs.some((ref) =>
    ref.referenceKey === currentRef.referenceKey
      ? false
      : tutorialShotArtifactPathsShareArtifacts({
          sourceRoot,
          leftPaths: currentArtifactPaths,
          rightPaths:
            sourceState.artifactPathsByReferenceKey.get(ref.referenceKey) ??
            getTutorialShotArtifactPaths(ref),
        }),
  );
  if (shouldBranch) {
    const branchedPaths = allocateBranchedTutorialShotPaths({
      sourceRoot,
      sourceState,
      manifest,
    });
    manifest = {
      ...manifest,
      id: branchedPaths.id,
      outputImagePath: branchedPaths.outputImagePath,
      rawImagePath: branchedPaths.rawImagePath,
    };
  }

  const originalRawAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: originalManifest.rawImagePath,
    validator: (contentPath) =>
      isExpectedTutorialShotRawImagePath({
        pagePath: originalManifest.pagePath,
        outputImagePath: originalManifest.outputImagePath,
        rawImagePath: contentPath,
      }),
  });
  const originalRawExists = await resolveExistingFile(originalRawAbsPath);
  let rawBuffer = null;
  let shouldWriteRawImage = false;

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
    rawBuffer = buffer;
    shouldWriteRawImage = true;
  } else if (originalRawExists) {
    rawBuffer = await fs.readFile(originalRawAbsPath);
    if (shouldBranch) {
      manifest = {
        ...manifest,
        rawImagePath: deriveTutorialShotRawImagePath({
          pagePath: manifest.pagePath,
          outputImagePath: manifest.outputImagePath,
          fallbackExtension: getTutorialShotFileExtension(originalManifest.rawImagePath),
        }),
      };
      shouldWriteRawImage = true;
    }
  } else if (shouldBranch || bootstrapFromOutput) {
    const requestedBootstrapPath =
      typeof bootstrapImagePath === "string" && bootstrapImagePath.trim()
        ? normalizeDecodedPosixPath(bootstrapImagePath)
        : null;
    const bootstrapCandidates = shouldBranch
      ? [currentRef.referencedImagePath, originalManifest.outputImagePath, requestedBootstrapPath]
      : [requestedBootstrapPath, originalManifest.outputImagePath];
    const legacyExtension = getTutorialShotFileExtension(originalManifest.rawImagePath);
    if (!requestedBootstrapPath && legacyExtension) {
      bootstrapCandidates.push(
        replaceTutorialShotPathExtension(originalManifest.outputImagePath, legacyExtension),
      );
    }

    let resolvedBootstrap = null;
    for (const candidate of [...new Set(bootstrapCandidates.filter(Boolean))]) {
      const candidateAbsPath = resolveSourcePath({
        sourceRoot,
        contentRelativePath: candidate,
        validator: isTutorialShotReadableImagePath,
      });
      if (!shouldBranch) {
        const candidatePaths = deriveTutorialShotPaths({
          pagePath: originalManifest.pagePath,
          outputImagePath: candidate,
        });
        if (candidatePaths.id !== originalManifest.id) {
          throw new Error("現在の出力画像と保存対象のショットが一致しません。");
        }
      }
      if (await resolveExistingFile(candidateAbsPath)) {
        resolvedBootstrap = { absolutePath: candidateAbsPath, contentPath: candidate };
        break;
      }
    }
    if (!resolvedBootstrap) {
      throw new Error(
        "現在の出力画像が無いため、そこから元画像を初期作成できません。先に元画像をアップロードしてください。",
      );
    }
    manifest = {
      ...manifest,
      rawImagePath: deriveTutorialShotRawImagePath({
        pagePath: manifest.pagePath,
        outputImagePath: manifest.outputImagePath,
        fallbackExtension: getTutorialShotFileExtension(resolvedBootstrap.contentPath),
      }),
    };
    rawBuffer = await fs.readFile(resolvedBootstrap.absolutePath);
    shouldWriteRawImage = true;
  }

  if (!rawBuffer) {
    throw new Error(
      "元画像がまだ無いため、この Action 画像は保存できません。先に元画像をアップロードしてください。",
    );
  }

  const outputAbsPath = resolveSourcePath({
    sourceRoot,
    contentRelativePath: manifest.outputImagePath,
    validator: isTutorialShotOutputImagePath,
  });
  const rawAbsPath = resolveSourcePath({
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

  let outputBuffer;
  if (animatedOutputPlan) {
    outputBuffer = await renderAnimatedWebpTutorialShotImage({
      rawBuffer,
      crop,
      outputLayout,
      overlaySvg,
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
    outputBuffer = await renderGeneratedTutorialShotImage({
      image: generatedImage,
      outputImagePath: manifest.outputImagePath,
      outputFormat,
    });
  }

  const savedManifest = {
    ...manifest,
    crop,
  };

  const pageRelativeOutputImagePath = getTutorialShotPageRelativeOutputImagePath({
    pagePath: manifest.pagePath,
    outputImagePath: manifest.outputImagePath,
  });
  const nextPageSourceText = replaceTutorialShotSourceRef({
    sourceText: page.sourceText,
    sourceRef,
    nextImg: pageRelativeOutputImagePath,
  });
  const nextSourceRef = extractTutorialShotSourceRefs({
    pagePath: manifest.pagePath,
    sourceText: nextPageSourceText,
  }).find(
    (ref) =>
      ref.tagName === sourceRef.tagName &&
      ref.tagStart === sourceRef.tagStart &&
      ref.expectedImg === pageRelativeOutputImagePath,
  );
  if (!nextSourceRef) {
    throw new Error("保存後のチュートリアル画像参照を特定できませんでした。");
  }

  await assertTutorialShotSourceStateUnchanged({ sourceRoot, sourceState });
  const fileEntries = [
    {
      targetPath: outputAbsPath,
      data: outputBuffer,
    },
    {
      targetPath: manifestAbsPath,
      data: `${JSON.stringify(savedManifest, null, 2)}\n`,
    },
    {
      targetPath: pageAbsPath,
      data: nextPageSourceText,
    },
  ];
  if (shouldWriteRawImage) {
    fileEntries.unshift({
      targetPath: rawAbsPath,
      data: rawBuffer,
    });
  }
  const { cleanupWarnings } = await commitTutorialShotFiles(fileEntries, { fileOps });

  return {
    manifest: savedManifest,
    sourceRef: nextSourceRef,
    warnings: [
      ...getTutorialShotWarnings(savedManifest, { shotSource: currentRef.shotSource }),
      ...cleanupWarnings,
    ],
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

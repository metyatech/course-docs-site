export const TUTORIAL_SHOT_MANIFEST_VERSION = 1;
export const TUTORIAL_SHOT_ANNOTATION_MODES = ["focal", "multi-focal", "callout"];
export const TUTORIAL_SHOT_BOX_ROLES = ["action", "verify"];
export const TUTORIAL_SHOT_STATIC_RASTER_OUTPUT_FORMAT = {
  label: "WebP",
  mimeType: "image/webp",
  extension: ".webp",
  sharpFormat: "webp-lossless",
};
export const TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION =
  TUTORIAL_SHOT_STATIC_RASTER_OUTPUT_FORMAT.extension;
export const TUTORIAL_SHOT_GENERATED_IMAGE_FORMATS = [
  TUTORIAL_SHOT_STATIC_RASTER_OUTPUT_FORMAT,
  {
    label: "PNG",
    mimeType: "image/png",
    extension: ".png",
    sharpFormat: "png",
  },
  {
    label: "JPEG",
    mimeType: "image/jpeg",
    extension: ".jpg",
    aliases: [".jpeg"],
    sharpFormat: "jpeg",
  },
];
export const TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS = [
  {
    label: "PNG",
    mimeTypes: ["image/png"],
    extensions: [".png"],
  },
  {
    label: "APNG",
    mimeTypes: ["image/apng"],
    extensions: [".apng"],
  },
  {
    label: "JPEG",
    mimeTypes: ["image/jpeg", "image/pjpeg"],
    extensions: [".jpg", ".jpeg", ".jfif", ".jpe", ".jif"],
  },
  {
    label: "GIF",
    mimeTypes: ["image/gif"],
    extensions: [".gif"],
  },
  {
    label: "WebP",
    mimeTypes: ["image/webp"],
    extensions: [".webp"],
  },
  {
    label: "AVIF",
    mimeTypes: ["image/avif"],
    extensions: [".avif"],
  },
  {
    label: "SVG",
    mimeTypes: ["image/svg+xml", "image/svg"],
    extensions: [".svg"],
  },
  {
    label: "BMP",
    mimeTypes: ["image/bmp", "image/x-bmp", "image/x-ms-bmp", "image/x-windows-bmp"],
    extensions: [".bmp", ".dib"],
  },
  {
    label: "ICO/CUR",
    mimeTypes: [
      "image/x-icon",
      "image/vnd.microsoft.icon",
      "image/ico",
      "image/icon",
      "image/x-ico",
      "image/cursor",
      "image/x-cursor",
    ],
    extensions: [".ico", ".cur"],
  },
];
export const TUTORIAL_SHOT_SOURCE_IMAGE_FORMAT_LABEL = TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS.map(
  (format) => format.label,
).join("/");

const TUTORIAL_SHOT_SOURCE_IMAGE_MIME_TYPES = new Set(
  TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS.flatMap((format) => format.mimeTypes),
);
const TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSIONS = new Set(
  TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS.flatMap((format) => format.extensions),
);
const TUTORIAL_SHOT_GENERATED_IMAGE_EXTENSIONS = new Set(
  TUTORIAL_SHOT_GENERATED_IMAGE_FORMATS.flatMap((format) => [
    format.extension,
    ...(format.aliases ?? []),
  ]),
);

export const TUTORIAL_SHOT_SOURCE_IMAGE_ACCEPT = TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS.flatMap(
  (format) => [...format.mimeTypes, ...format.extensions],
).join(",");

const normalizeMimeType = (value) =>
  String(value ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

const TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSION_BY_MIME_TYPE = new Map(
  TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS.flatMap((format) =>
    format.mimeTypes.map((mimeType) => [normalizeMimeType(mimeType), format.extensions[0]]),
  ),
);
const TUTORIAL_SHOT_GENERATED_IMAGE_FORMAT_BY_EXTENSION = new Map(
  TUTORIAL_SHOT_GENERATED_IMAGE_FORMATS.flatMap((format) =>
    [format.extension, ...(format.aliases ?? [])].map((extension) => [extension, format]),
  ),
);
const TUTORIAL_SHOT_IMAGE_CONTENT_TYPE_BY_EXTENSION = new Map([
  ...TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS.flatMap((format) =>
    format.extensions.map((extension) => [extension, normalizeMimeType(format.mimeTypes[0])]),
  ),
  ...TUTORIAL_SHOT_GENERATED_IMAGE_FORMATS.flatMap((format) =>
    [format.extension, ...(format.aliases ?? [])].map((extension) => [extension, format.mimeType]),
  ),
]);

export const getTutorialShotFileExtension = (value) => {
  const basename =
    String(value ?? "")
      .split(/[\\/]/u)
      .at(-1) ?? "";
  const index = basename.lastIndexOf(".");
  return index <= 0 ? "" : basename.slice(index).toLowerCase();
};

const getFormatByMimeType = (formats, mimeType) => {
  const normalized = normalizeMimeType(mimeType);
  return formats.find((format) => format.mimeTypes.includes(normalized));
};

export const isTutorialShotSourceImageMimeType = (mimeType) =>
  TUTORIAL_SHOT_SOURCE_IMAGE_MIME_TYPES.has(normalizeMimeType(mimeType));

export const getTutorialShotSourceImageExtensionForMimeType = (mimeType) =>
  getFormatByMimeType(TUTORIAL_SHOT_SOURCE_IMAGE_FORMATS, mimeType)?.extensions[0] ?? "";

export const getTutorialShotSourceImageExtensionForFileName = (fileName) => {
  const extension = getTutorialShotFileExtension(fileName);
  return TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSIONS.has(extension) ? extension : "";
};

export const isTutorialShotSourceImageFileName = (fileName) =>
  TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSIONS.has(getTutorialShotFileExtension(fileName));

export const isTutorialShotSourceImageFile = (file) =>
  Boolean(file) &&
  (isTutorialShotSourceImageMimeType(file.type) || isTutorialShotSourceImageFileName(file.name));

export const getTutorialShotSourceImageExtension = ({
  fileName = "",
  mimeType = "",
  fallbackExtension = "",
} = {}) => {
  const fileExtension = getTutorialShotFileExtension(fileName);
  if (TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSIONS.has(fileExtension)) {
    return fileExtension;
  }

  const mimeExtension = TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSION_BY_MIME_TYPE.get(
    normalizeMimeType(mimeType),
  );
  if (mimeExtension) {
    return mimeExtension;
  }

  const normalizedFallback = String(fallbackExtension ?? "").toLowerCase();
  if (TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSIONS.has(normalizedFallback)) {
    return normalizedFallback;
  }

  return TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION;
};

export const getTutorialShotGeneratedImageFormat = (fileName) => {
  const extension =
    getTutorialShotFileExtension(fileName) || TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION;
  return TUTORIAL_SHOT_GENERATED_IMAGE_FORMAT_BY_EXTENSION.get(extension) ?? null;
};

export const getTutorialShotImageContentType = (fileName) =>
  TUTORIAL_SHOT_IMAGE_CONTENT_TYPE_BY_EXTENSION.get(getTutorialShotFileExtension(fileName)) ?? null;

const ACTION_TAG_PATTERN = /<Action\b[\s\S]*?>/gu;
const VERIFY_TAG_PATTERN = /<Verify\b[\s\S]*?>/gu;
const IMG_PROP_PATTERN = /\bimg=(["'])(.*?)\1/u;

export const normalizePosixPath = (value) =>
  value
    .replaceAll("\\", "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/^\.\//u, "");

const decodePathSegment = (segment) => {
  if (!segment || segment === "." || segment === "..") {
    return segment;
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export const normalizeDecodedPosixPath = (value) =>
  normalizePosixPath(value).split("/").map(decodePathSegment).join("/");

export const isTutorialShotSourceImagePath = (value) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  return /^content\/.+/u.test(normalized) && isTutorialShotSourceImageFileName(normalized);
};

const splitPosixSegments = (value) =>
  normalizePosixPath(value)
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

const joinPosixPath = (...parts) => {
  const output = [];

  for (const part of parts) {
    for (const segment of splitPosixSegments(part)) {
      if (segment === "..") {
        output.pop();
        continue;
      }

      output.push(segment);
    }
  }

  return output.join("/");
};

const posixDirname = (value) => {
  const segments = splitPosixSegments(value);
  if (segments.length <= 1) {
    return ".";
  }

  return segments.slice(0, -1).join("/");
};

const posixBasename = (value) => {
  const segments = splitPosixSegments(value);
  return segments.at(-1) ?? "";
};

const posixExtname = (value) => {
  const basename = posixBasename(value);
  const index = basename.lastIndexOf(".");
  return index <= 0 ? "" : basename.slice(index);
};

export const replaceTutorialShotPathExtension = (value, extension) => {
  const normalized = normalizeDecodedPosixPath(value);
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const currentExtension = posixExtname(normalized);
  if (!currentExtension) {
    return `${normalized}${normalizedExtension}`;
  }

  return `${normalized.slice(0, -currentExtension.length)}${normalizedExtension}`;
};

export const applyTutorialShotStaticRasterOutputPolicy = (outputImagePath) =>
  replaceTutorialShotPathExtension(
    outputImagePath,
    TUTORIAL_SHOT_STATIC_RASTER_OUTPUT_FORMAT.extension,
  );

const isSafeContentRelativePath = (value) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  return normalized.startsWith("content/") && !splitPosixSegments(normalized).includes("..");
};

export const isTutorialShotGeneratedImagePath = (value) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  return (
    isSafeContentRelativePath(normalized) &&
    TUTORIAL_SHOT_GENERATED_IMAGE_EXTENSIONS.has(posixExtname(normalized).toLowerCase())
  );
};

export const isTutorialShotOutputImagePath = (value) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  return (
    isSafeContentRelativePath(normalized) &&
    posixExtname(normalized) === TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION
  );
};

export const isTutorialShotRawImagePath = (value) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  return (
    isSafeContentRelativePath(normalized) &&
    /^content\/.+\/shots\/.+\.raw\.[^/.]+$/u.test(normalized) &&
    isTutorialShotSourceImageFileName(normalized)
  );
};

export const isTutorialShotReadableImagePath = (value) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  return (
    isSafeContentRelativePath(normalized) && getTutorialShotImageContentType(normalized) !== null
  );
};

export const isTutorialShotManifestPath = (value) => {
  const normalized = normalizeDecodedPosixPath(value ?? "");
  return (
    isSafeContentRelativePath(normalized) &&
    /^content\/.+\/shots\/.+\.shot\.json$/u.test(normalized)
  );
};

export const sanitizeShotId = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "") || "shot";

export const deriveTutorialShotPaths = ({ pagePath, outputImagePath, rawImageExtension = "" }) => {
  const normalizedPagePath = normalizePosixPath(pagePath);
  const requestedOutputPath = normalizeDecodedPosixPath(outputImagePath);
  const normalizedOutputPath = applyTutorialShotStaticRasterOutputPolicy(requestedOutputPath);
  const pageDir = posixDirname(normalizedPagePath);
  const requestedBasename = posixBasename(requestedOutputPath);
  const requestedOutputExtension = posixExtname(requestedBasename);
  const outputBasename = posixBasename(normalizedOutputPath);
  const explicitOutputExtension = posixExtname(outputBasename);
  const outputExtension = explicitOutputExtension || TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION;
  const outputName = explicitOutputExtension
    ? outputBasename.slice(0, outputBasename.length - outputExtension.length)
    : outputBasename;
  const rawExtension =
    getTutorialShotSourceImageExtension({
      fallbackExtension: rawImageExtension || requestedOutputExtension || outputExtension,
    }) || TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION;
  const shotId = sanitizeShotId(outputName);

  return {
    id: shotId,
    outputImagePath: normalizedOutputPath,
    manifestPath: joinPosixPath(pageDir, `shots/${outputName}.shot.json`),
    rawImagePath: joinPosixPath(pageDir, `shots/${outputName}.raw${rawExtension}`),
  };
};

export const deriveTutorialShotRawImagePath = ({
  pagePath,
  outputImagePath,
  sourceFileName = "",
  mimeType = "",
  fallbackExtension = "",
}) => {
  const rawExtension =
    getTutorialShotSourceImageExtension({
      fileName: sourceFileName,
      mimeType,
      fallbackExtension,
    }) || TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION;
  return deriveTutorialShotPaths({ pagePath, outputImagePath, rawImageExtension: rawExtension })
    .rawImagePath;
};

export const isExpectedTutorialShotRawImagePath = ({ pagePath, outputImagePath, rawImagePath }) => {
  const normalizedRawPath = normalizeDecodedPosixPath(rawImagePath ?? "");
  const rawExtension = posixExtname(normalizedRawPath).toLowerCase();
  if (!TUTORIAL_SHOT_SOURCE_IMAGE_EXTENSIONS.has(rawExtension)) {
    return false;
  }

  return (
    normalizedRawPath ===
    deriveTutorialShotRawImagePath({
      pagePath,
      outputImagePath,
      fallbackExtension: rawExtension,
    })
  );
};

export const createDefaultTutorialShotManifest = ({ pagePath, outputImagePath }) => {
  const derived = deriveTutorialShotPaths({ pagePath, outputImagePath });

  return {
    version: TUTORIAL_SHOT_MANIFEST_VERSION,
    id: derived.id,
    pagePath: normalizePosixPath(pagePath),
    outputImagePath: derived.outputImagePath,
    rawImagePath: derived.rawImagePath,
    crop: null,
    annotations: [],
    annotationMode: "focal",
    alt: "",
  };
};

const getPosixRelativePath = ({ fromDir, toPath }) => {
  const fromSegments = splitPosixSegments(fromDir);
  const toSegments = splitPosixSegments(toPath);
  let sharedCount = 0;

  while (
    sharedCount < fromSegments.length &&
    sharedCount < toSegments.length &&
    fromSegments[sharedCount] === toSegments[sharedCount]
  ) {
    sharedCount += 1;
  }

  const upSegments = fromSegments.slice(sharedCount).map(() => "..");
  const downSegments = toSegments.slice(sharedCount);
  return [...upSegments, ...downSegments].join("/") || posixBasename(toPath);
};

export const getTutorialShotPageRelativeOutputImagePath = ({ pagePath, outputImagePath }) => {
  const relative = getPosixRelativePath({
    fromDir: posixDirname(normalizePosixPath(pagePath)),
    toPath: applyTutorialShotStaticRasterOutputPolicy(outputImagePath),
  });

  return relative.startsWith("..") ? relative : `./${relative}`;
};

const isExternalImageSrc = (value) => /^(https?:)?\/\//iu.test(value);

const extractImageRefsFromMdxTag = ({ pagePath, sourceText, tagPattern }) => {
  const normalizedPagePath = normalizePosixPath(pagePath);
  const pageDir = posixDirname(normalizedPagePath);
  const refs = [];

  for (const match of sourceText.matchAll(tagPattern)) {
    const tag = match[0];
    const imgMatch = tag.match(IMG_PROP_PATTERN);
    if (!imgMatch) {
      continue;
    }

    const rawSrc = imgMatch[2]?.trim();
    if (!rawSrc || isExternalImageSrc(rawSrc)) {
      continue;
    }

    const sourceImagePath = normalizeDecodedPosixPath(rawSrc);
    const referencedImagePath = normalizeDecodedPosixPath(joinPosixPath(pageDir, rawSrc));
    const line = sourceText.slice(0, match.index ?? 0).split(/\r?\n/gu).length;
    const derived = deriveTutorialShotPaths({
      pagePath: normalizedPagePath,
      outputImagePath: referencedImagePath,
      rawImageExtension: posixExtname(referencedImagePath),
    });

    refs.push({
      id: derived.id,
      line,
      pagePath: normalizedPagePath,
      sourceImagePath,
      referencedImagePath,
      outputImagePath: derived.outputImagePath,
      manifestPath: derived.manifestPath,
      rawImagePath: derived.rawImagePath,
    });
  }

  return refs;
};

export const extractActionImageRefsFromMdx = ({ pagePath, sourceText }) =>
  extractImageRefsFromMdxTag({ pagePath, sourceText, tagPattern: ACTION_TAG_PATTERN });

export const extractVerifyImageRefsFromMdx = ({ pagePath, sourceText }) =>
  extractImageRefsFromMdxTag({ pagePath, sourceText, tagPattern: VERIFY_TAG_PATTERN });

export const rewriteTutorialShotImageRefsForOutputPolicy = ({
  pagePath,
  sourceText,
  outputImagePath,
}) => {
  const normalizedPagePath = normalizePosixPath(pagePath);
  const policyOutputPath = applyTutorialShotStaticRasterOutputPolicy(outputImagePath);
  const pageDir = posixDirname(normalizedPagePath);
  const targetId = deriveTutorialShotPaths({
    pagePath: normalizedPagePath,
    outputImagePath: policyOutputPath,
  }).id;
  const pageRelativeOutputPath = getTutorialShotPageRelativeOutputImagePath({
    pagePath: normalizedPagePath,
    outputImagePath: policyOutputPath,
  });
  let changed = false;

  const replaceTag = (tag) => {
    const imgMatch = IMG_PROP_PATTERN.exec(tag);
    if (!imgMatch) {
      return tag;
    }

    const rawSrc = imgMatch[2]?.trim();
    if (!rawSrc || isExternalImageSrc(rawSrc)) {
      return tag;
    }

    const currentImagePath = normalizeDecodedPosixPath(joinPosixPath(pageDir, rawSrc));
    const currentId = deriveTutorialShotPaths({
      pagePath: normalizedPagePath,
      outputImagePath: currentImagePath,
    }).id;
    if (currentId !== targetId) {
      return tag;
    }

    const quote = imgMatch[1];
    const nextImgProp = `img=${quote}${pageRelativeOutputPath}${quote}`;
    if (imgMatch[0] === nextImgProp) {
      return tag;
    }

    changed = true;
    return `${tag.slice(0, imgMatch.index)}${nextImgProp}${tag.slice(
      imgMatch.index + imgMatch[0].length,
    )}`;
  };

  const nextSourceText = sourceText
    .replace(ACTION_TAG_PATTERN, replaceTag)
    .replace(VERIFY_TAG_PATTERN, replaceTag);

  return {
    sourceText: nextSourceText,
    changed,
  };
};

const normalizeAnnotation = (annotation) => {
  if (!annotation || typeof annotation !== "object") {
    return null;
  }

  if (annotation.type === "box") {
    if (!TUTORIAL_SHOT_BOX_ROLES.includes(annotation.role)) {
      throw new Error(
        `box annotation に role が必要です（"action" または "verify"）。対象 id: ${annotation.id ?? "(unknown)"}`,
      );
    }
    return {
      id: typeof annotation.id === "string" ? annotation.id : crypto.randomUUID(),
      type: "box",
      role: annotation.role,
      x: Number(annotation.x) || 0,
      y: Number(annotation.y) || 0,
      width: Math.max(1, Number(annotation.width) || 0),
      height: Math.max(1, Number(annotation.height) || 0),
    };
  }

  if (annotation.type === "arrow") {
    return {
      id: typeof annotation.id === "string" ? annotation.id : crypto.randomUUID(),
      type: "arrow",
      fromX: Number(annotation.fromX) || 0,
      fromY: Number(annotation.fromY) || 0,
      toX: Number(annotation.toX) || 0,
      toY: Number(annotation.toY) || 0,
    };
  }

  return null;
};

export const normalizeTutorialShotManifest = (manifest) => {
  const normalized = createDefaultTutorialShotManifest({
    pagePath: manifest?.pagePath ?? "",
    outputImagePath: manifest?.outputImagePath ?? "",
  });

  return {
    ...normalized,
    version: TUTORIAL_SHOT_MANIFEST_VERSION,
    id:
      typeof manifest?.id === "string" && manifest.id.trim()
        ? sanitizeShotId(manifest.id)
        : normalized.id,
    pagePath: normalizePosixPath(manifest?.pagePath ?? normalized.pagePath),
    outputImagePath: normalizeDecodedPosixPath(
      manifest?.outputImagePath ?? normalized.outputImagePath,
    ),
    rawImagePath: normalizeDecodedPosixPath(manifest?.rawImagePath ?? normalized.rawImagePath),
    annotationMode: TUTORIAL_SHOT_ANNOTATION_MODES.includes(manifest?.annotationMode)
      ? manifest.annotationMode
      : "focal",
    alt: typeof manifest?.alt === "string" ? manifest.alt.trim() : "",
    crop:
      manifest?.crop &&
      Number.isFinite(Number(manifest.crop.x)) &&
      Number.isFinite(Number(manifest.crop.y)) &&
      Number.isFinite(Number(manifest.crop.width)) &&
      Number.isFinite(Number(manifest.crop.height))
        ? {
            x: Math.max(0, Math.round(Number(manifest.crop.x))),
            y: Math.max(0, Math.round(Number(manifest.crop.y))),
            width: Math.max(1, Math.round(Number(manifest.crop.width))),
            height: Math.max(1, Math.round(Number(manifest.crop.height))),
          }
        : null,
    annotations: Array.isArray(manifest?.annotations)
      ? manifest.annotations.map(normalizeAnnotation).filter(Boolean)
      : [],
  };
};

export const summarizeTutorialShotAnnotations = (annotations) => {
  const list = Array.isArray(annotations) ? annotations : [];
  const boxCount = list.filter((annotation) => annotation?.type === "box").length;
  const arrowCount = list.filter((annotation) => annotation?.type === "arrow").length;

  return {
    totalCount: list.length,
    boxCount,
    arrowCount,
  };
};

export const getTutorialShotAnnotationErrors = (annotations, annotationMode = "focal") => {
  const { boxCount, arrowCount } = summarizeTutorialShotAnnotations(annotations);
  const errors = [];

  if (annotationMode === "callout") {
    if (arrowCount > 0) {
      errors.push("番号コールアウトモードでは矢印は使えません。不要な矢印を削除してください。");
    }
    return errors;
  }

  if (annotationMode === "multi-focal") {
    if (arrowCount > 0) {
      errors.push("同種複数モードでは矢印は使えません。不要な矢印を削除してください。");
    }
    return errors;
  }

  if (boxCount > 1) {
    errors.push(
      "注目点モードの枠は 1 つだけです。複数の場所を示すには同種複数か番号コールアウトモードに切り替えてください。",
    );
  }

  if (arrowCount > 1) {
    errors.push("矢印は 1 本だけにしてください。");
  }

  if (arrowCount > 0 && boxCount === 0) {
    errors.push("矢印だけは使えません。矢印を使うなら注目点を示す枠を 1 つ追加してください。");
  }

  return errors;
};

/**
 * Returns warning strings for a tutorial shot manifest.
 *
 * @param {object} manifest - The shot manifest.
 * @param {{ shotSource?: "action" | "verify" }} [options]
 *   shotSource: whether the shot comes from <Action img> or <Verify img>.
 *   When "verify", any annotation with role="action" is a violation because
 *   Verify screenshots must only use verify-role (white dashed) boxes.
 */
export const getTutorialShotWarnings = (manifest, { shotSource } = {}) => {
  const annotations = Array.isArray(manifest?.annotations) ? manifest.annotations : [];
  const annotationMode = TUTORIAL_SHOT_ANNOTATION_MODES.includes(manifest?.annotationMode)
    ? manifest.annotationMode
    : "focal";

  const errors = getTutorialShotAnnotationErrors(annotations, annotationMode);

  // Verify shots must not have role="action" (orange solid) annotations.
  // These are visible in /dev/tutorial-shots/ — open the shot and change the
  // annotation role to 確認（白い破線）.
  if (shotSource === "verify") {
    const hasActionRole = annotations.some((a) => a.type === "box" && a.role === "action");
    if (hasActionRole) {
      errors.push(
        "Verify 画像にアクション（オレンジ実線）の枠が含まれています。" +
          "確認（白い破線）に変更してください。",
      );
    }
  }

  return errors;
};

const renderArrowHead = ({ fromX, fromY, toX, toY, strokeWidth }) => {
  const points = getArrowHeadPoints({ fromX, fromY, toX, toY, strokeWidth });
  return points.map(({ x, y }) => `${x},${y}`).join(" ");
};

const OVERLAY_STROKE_WIDTH = 4;
const OVERLAY_STROKE_MARGIN = OVERLAY_STROKE_WIDTH / 2;
const CALLOUT_BADGE_STROKE_WIDTH = 2.5;
const CALLOUT_BADGE_STROKE_MARGIN = CALLOUT_BADGE_STROKE_WIDTH / 2;
export const TUTORIAL_SHOT_EDITOR_WORKSPACE_PADDING = 96;

const getArrowHeadPoints = ({ fromX, fromY, toX, toY, strokeWidth }) => {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = Math.max(12, strokeWidth * 4);
  const spread = Math.PI / 8;
  const x1 = toX - headLength * Math.cos(angle - spread);
  const y1 = toY - headLength * Math.sin(angle - spread);
  const x2 = toX - headLength * Math.cos(angle + spread);
  const y2 = toY - headLength * Math.sin(angle + spread);

  return [
    { x: toX, y: toY },
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ];
};

const CALLOUT_BADGE_RADIUS = 16;

const renderCalloutBadge = ({ cx, cy, number, role = "action" }) => {
  const r = CALLOUT_BADGE_RADIUS;
  if (role === "verify") {
    return [
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" stroke="#64748b" stroke-width="2.5" />`,
      `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Arial, 'Noto Sans JP', sans-serif" font-size="18" font-weight="700" fill="#64748b">${number}</text>`,
    ].join("");
  }
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ff6b00" stroke="#ffffff" stroke-width="2.5" />`,
    `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Arial, 'Noto Sans JP', sans-serif" font-size="18" font-weight="700" fill="#ffffff">${number}</text>`,
  ].join("");
};

const expandBounds = (current, { minX, minY, maxX, maxY }) =>
  current
    ? {
        minX: Math.min(current.minX, minX),
        minY: Math.min(current.minY, minY),
        maxX: Math.max(current.maxX, maxX),
        maxY: Math.max(current.maxY, maxY),
      }
    : { minX, minY, maxX, maxY };

export const getTutorialShotAnnotationBounds = ({ annotations, annotationMode = "focal" }) => {
  let bounds = null;

  for (const annotation of annotations ?? []) {
    if (annotation.type === "box") {
      bounds = expandBounds(bounds, {
        minX: annotation.x - OVERLAY_STROKE_MARGIN,
        minY: annotation.y - OVERLAY_STROKE_MARGIN,
        maxX: annotation.x + annotation.width + OVERLAY_STROKE_MARGIN,
        maxY: annotation.y + annotation.height + OVERLAY_STROKE_MARGIN,
      });

      if (annotationMode === "callout") {
        bounds = expandBounds(bounds, {
          minX: annotation.x - CALLOUT_BADGE_RADIUS - CALLOUT_BADGE_STROKE_MARGIN,
          minY: annotation.y - CALLOUT_BADGE_RADIUS - CALLOUT_BADGE_STROKE_MARGIN,
          maxX: annotation.x + CALLOUT_BADGE_RADIUS + CALLOUT_BADGE_STROKE_MARGIN,
          maxY: annotation.y + CALLOUT_BADGE_RADIUS + CALLOUT_BADGE_STROKE_MARGIN,
        });
      }

      continue;
    }

    if (annotation.type === "arrow") {
      const arrowHeadPoints = getArrowHeadPoints({
        fromX: annotation.fromX,
        fromY: annotation.fromY,
        toX: annotation.toX,
        toY: annotation.toY,
        strokeWidth: OVERLAY_STROKE_WIDTH,
      });
      const xs = [annotation.fromX, ...arrowHeadPoints.map((point) => point.x)];
      const ys = [annotation.fromY, ...arrowHeadPoints.map((point) => point.y)];
      bounds = expandBounds(bounds, {
        minX: Math.min(...xs) - OVERLAY_STROKE_MARGIN,
        minY: Math.min(...ys) - OVERLAY_STROKE_MARGIN,
        maxX: Math.max(...xs) + OVERLAY_STROKE_MARGIN,
        maxY: Math.max(...ys) + OVERLAY_STROKE_MARGIN,
      });
    }
  }

  return bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
};

export const getTutorialShotCanvasLayout = ({
  imageWidth,
  imageHeight,
  annotations,
  annotationMode = "focal",
  workspacePadding = 0,
}) => {
  const safeImageWidth = Math.max(1, Math.round(Number(imageWidth) || 0));
  const safeImageHeight = Math.max(1, Math.round(Number(imageHeight) || 0));
  const safePadding = Math.max(0, Math.round(Number(workspacePadding) || 0));
  const annotationBounds = getTutorialShotAnnotationBounds({ annotations, annotationMode });
  const contentMinX = Math.min(0, Math.floor(annotationBounds.minX));
  const contentMinY = Math.min(0, Math.floor(annotationBounds.minY));
  const contentMaxX = Math.max(safeImageWidth, Math.ceil(annotationBounds.maxX));
  const contentMaxY = Math.max(safeImageHeight, Math.ceil(annotationBounds.maxY));

  return {
    height: contentMaxY - contentMinY + safePadding * 2,
    imageX: -contentMinX + safePadding,
    imageY: -contentMinY + safePadding,
    width: contentMaxX - contentMinX + safePadding * 2,
  };
};

export const renderTutorialShotOverlaySvg = ({
  width,
  height,
  annotations,
  annotationMode = "focal",
  offsetX = 0,
  offsetY = 0,
}) => {
  const shapes = [];
  let calloutIndex = 0;

  for (const annotation of annotations ?? []) {
    if (annotation.type === "box") {
      const isVerify = annotation.role === "verify";
      const strokeColor = isVerify ? "#ffffff" : "#ff6b00";
      const strokeDash = isVerify ? ` stroke-dasharray="12 8"` : "";
      shapes.push(
        `<rect x="${annotation.x}" y="${annotation.y}" width="${annotation.width}" height="${annotation.height}" rx="10" ry="10" fill="none" stroke="${strokeColor}" stroke-width="4"${strokeDash} />`,
      );
      if (annotationMode === "callout") {
        calloutIndex += 1;
        const cx = annotation.x;
        const cy = annotation.y;
        shapes.push(renderCalloutBadge({ cx, cy, number: calloutIndex, role: annotation.role }));
      }
      continue;
    }

    if (annotation.type === "arrow") {
      shapes.push(
        `<line x1="${annotation.fromX}" y1="${annotation.fromY}" x2="${annotation.toX}" y2="${annotation.toY}" stroke="#ff6b00" stroke-width="4" stroke-linecap="round" />`,
      );
      shapes.push(
        `<polygon points="${renderArrowHead({
          fromX: annotation.fromX,
          fromY: annotation.fromY,
          toX: annotation.toX,
          toY: annotation.toY,
          strokeWidth: 4,
        })}" fill="#ff6b00" />`,
      );
      continue;
    }
  }

  const translatedShapes =
    offsetX !== 0 || offsetY !== 0
      ? `<g transform="translate(${offsetX} ${offsetY})">${shapes.join("")}</g>`
      : shapes.join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${translatedShapes}</svg>`;
};

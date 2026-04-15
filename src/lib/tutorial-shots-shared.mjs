export const TUTORIAL_SHOT_MANIFEST_VERSION = 1;
export const TUTORIAL_SHOT_ANNOTATION_MODES = ["focal", "callout"];
export const TUTORIAL_SHOT_BOX_ROLES = ["action", "verify"];

const ACTION_TAG_PATTERN = /<Action\b[\s\S]*?>/gu;
const SECTION_TAG_PATTERN = /<Section\b/u;
const IMG_PROP_PATTERN = /\bimg=(["'])(.*?)\1/u;
const YAML_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/u;
const TOML_FRONTMATTER_PATTERN = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+/u;

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
  normalizePosixPath(value)
    .split("/")
    .map(decodePathSegment)
    .join("/");

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

export const sanitizeShotId = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "") || "shot";

export const deriveTutorialShotPaths = ({ pagePath, outputImagePath }) => {
  const normalizedPagePath = normalizePosixPath(pagePath);
  const normalizedOutputPath = normalizeDecodedPosixPath(outputImagePath);
  const pageDir = posixDirname(normalizedPagePath);
  const outputBasename = posixBasename(normalizedOutputPath);
  const outputExtension = posixExtname(outputBasename) || ".png";
  const outputName = outputBasename.slice(0, outputBasename.length - outputExtension.length);
  const shotId = sanitizeShotId(outputName);

  return {
    id: shotId,
    manifestPath: joinPosixPath(pageDir, `shots/${outputName}.shot.json`),
    rawImagePath: joinPosixPath(pageDir, `shots/${outputName}.raw${outputExtension}`),
  };
};

export const createDefaultTutorialShotManifest = ({ pagePath, outputImagePath }) => {
  const normalizedOutputPath = normalizeDecodedPosixPath(outputImagePath);
  const derived = deriveTutorialShotPaths({ pagePath, outputImagePath: normalizedOutputPath });

  return {
    version: TUTORIAL_SHOT_MANIFEST_VERSION,
    id: derived.id,
    pagePath: normalizePosixPath(pagePath),
    outputImagePath: normalizedOutputPath,
    rawImagePath: derived.rawImagePath,
    crop: null,
    annotations: [],
    annotationMode: "focal",
    alt: "",
  };
};

export const extractActionImageRefsFromMdx = ({ pagePath, sourceText }) => {
  const normalizedPagePath = normalizePosixPath(pagePath);
  const pageDir = posixDirname(normalizedPagePath);
  const refs = [];

  for (const match of sourceText.matchAll(ACTION_TAG_PATTERN)) {
    const tag = match[0];
    const imgMatch = tag.match(IMG_PROP_PATTERN);
    if (!imgMatch) {
      continue;
    }

    const rawSrc = imgMatch[2]?.trim();
    if (!rawSrc || /^(https?:)?\/\//iu.test(rawSrc)) {
      continue;
    }

    const sourceImagePath = normalizeDecodedPosixPath(rawSrc);
    const outputImagePath = normalizeDecodedPosixPath(joinPosixPath(pageDir, rawSrc));
    const line = sourceText.slice(0, match.index ?? 0).split(/\r?\n/gu).length;
    const derived = deriveTutorialShotPaths({ pagePath: normalizedPagePath, outputImagePath });

    refs.push({
      id: derived.id,
      line,
      pagePath: normalizedPagePath,
      sourceImagePath,
      outputImagePath,
      manifestPath: derived.manifestPath,
      rawImagePath: derived.rawImagePath,
    });
  }

  return refs;
};

const normalizeAuthoringModeValue = (value) =>
  value
    .trim()
    .replace(/^['"`]/, "")
    .replace(/['"`]$/, "")
    .trim()
    .toLowerCase();

const toAuthoringMode = (value) => {
  const normalized = normalizeAuthoringModeValue(value);
  if (normalized === "tutorial") {
    return "tutorial";
  }
  if (normalized === "non-tutorial") {
    return "non-tutorial";
  }
  return null;
};

const extractYamlLikeAuthoringMode = (source, separator) => {
  for (const rawLine of source.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const pattern =
      separator === ":"
        ? /^authoringMode\s*:\s*(.+?)\s*(?:#.*)?$/u
        : /^authoringMode\s*=\s*(.+?)\s*(?:#.*)?$/u;
    const match = pattern.exec(line);
    if (match) {
      return match[1];
    }
  }

  return null;
};

const extractExplicitAuthoringMode = (sourceText) => {
  const yamlMatch = YAML_FRONTMATTER_PATTERN.exec(sourceText);
  if (yamlMatch) {
    const rawValue = extractYamlLikeAuthoringMode(yamlMatch[1], ":");
    if (rawValue !== null) {
      return {
        explicit: true,
        mode: toAuthoringMode(rawValue),
        rawValue,
      };
    }
  }

  const tomlMatch = TOML_FRONTMATTER_PATTERN.exec(sourceText);
  if (tomlMatch) {
    const rawValue = extractYamlLikeAuthoringMode(tomlMatch[1], "=");
    if (rawValue !== null) {
      return {
        explicit: true,
        mode: toAuthoringMode(rawValue),
        rawValue,
      };
    }
  }

  const directExportMatch =
    /export\s+const\s+authoringMode\s*=\s*(['"`])([^'"`]+)\1/u.exec(sourceText);
  if (directExportMatch) {
    const rawValue = directExportMatch[2];
    return {
      explicit: true,
      mode: toAuthoringMode(rawValue),
      rawValue,
    };
  }

  const metadataExportMatch =
    /export\s+const\s+metadata\s*=\s*\{[\s\S]*?\bauthoringMode\s*:\s*(['"`])([^'"`]+)\1[\s\S]*?\}/u.exec(
      sourceText,
    );
  if (metadataExportMatch) {
    const rawValue = metadataExportMatch[2];
    return {
      explicit: true,
      mode: toAuthoringMode(rawValue),
      rawValue,
    };
  }

  return {
    explicit: false,
    mode: null,
    rawValue: null,
  };
};

export const getTutorialPageModeWarnings = ({ sourceText }) => {
  const warnings = [];
  const hasSection = SECTION_TAG_PATTERN.test(sourceText ?? "");

  if (!hasSection) {
    return warnings;
  }

  const authoringMode = extractExplicitAuthoringMode(sourceText ?? "");

  if (authoringMode.explicit && authoringMode.mode === null) {
    warnings.push(
      `このページの authoringMode は "${authoringMode.rawValue}" ですが、有効なのは "tutorial" / "non-tutorial" だけです。`,
    );
    return warnings;
  }

  if (!authoringMode.explicit) {
    warnings.push(
      "このページは <Section> を使っていますが `authoringMode: tutorial` がありません。course-docs-platform の新ルールに合わせて frontmatter か metadata export に追加してください。",
    );
    return warnings;
  }

  if (authoringMode.mode === "non-tutorial") {
    warnings.push(
      "このページは `authoringMode: non-tutorial` ですが <Section> を使っています。tutorial ページとして分けるか、ページ構成を見直してください。",
    );
  }

  return warnings;
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
    annotationMode:
      TUTORIAL_SHOT_ANNOTATION_MODES.includes(manifest?.annotationMode)
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

  if (boxCount > 1) {
    errors.push("注目点モードの枠は 1 つだけです。複数の場所を示すには番号コールアウトモードに切り替えてください。");
  }

  if (arrowCount > 1) {
    errors.push("矢印は 1 本だけにしてください。");
  }

  if (arrowCount > 0 && boxCount === 0) {
    errors.push("矢印だけは使えません。矢印を使うなら注目点を示す枠を 1 つ追加してください。");
  }

  return errors;
};

export const getTutorialShotWarnings = (manifest) => {
  const annotations = Array.isArray(manifest?.annotations) ? manifest.annotations : [];
  const annotationMode = TUTORIAL_SHOT_ANNOTATION_MODES.includes(manifest?.annotationMode)
    ? manifest.annotationMode
    : "focal";
  return getTutorialShotAnnotationErrors(annotations, annotationMode);
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

export const getTutorialShotAnnotationBounds = ({
  annotations,
  annotationMode = "focal",
}) => {
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
      const strokeColor = isVerify ? "#64748b" : "#ff6b00";
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

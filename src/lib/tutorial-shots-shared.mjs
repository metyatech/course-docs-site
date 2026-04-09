export const TUTORIAL_SHOT_MANIFEST_VERSION = 1;
export const MAX_TUTORIAL_BOX_COUNT = 1;
export const MAX_TUTORIAL_ARROW_COUNT = 1;

const ACTION_TAG_PATTERN = /<Action\b[\s\S]*?>/gu;
const IMG_PROP_PATTERN = /\bimg=(["'])(.*?)\1/u;

export const normalizePosixPath = (value) =>
  value
    .replaceAll("\\", "/")
    .replace(/\/{2,}/gu, "/")
    .replace(/^\.\//u, "");

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

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const deriveTutorialShotPaths = ({ pagePath, outputImagePath }) => {
  const normalizedPagePath = normalizePosixPath(pagePath);
  const normalizedOutputPath = normalizePosixPath(outputImagePath);
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
  const derived = deriveTutorialShotPaths({ pagePath, outputImagePath });

  return {
    version: TUTORIAL_SHOT_MANIFEST_VERSION,
    id: derived.id,
    pagePath: normalizePosixPath(pagePath),
    outputImagePath: normalizePosixPath(outputImagePath),
    rawImagePath: derived.rawImagePath,
    crop: null,
    annotations: [],
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

    const outputImagePath = joinPosixPath(pageDir, rawSrc);
    const line = sourceText.slice(0, match.index ?? 0).split(/\r?\n/gu).length;
    const derived = deriveTutorialShotPaths({ pagePath: normalizedPagePath, outputImagePath });

    refs.push({
      id: derived.id,
      line,
      pagePath: normalizedPagePath,
      sourceImagePath: rawSrc,
      outputImagePath,
      manifestPath: derived.manifestPath,
      rawImagePath: derived.rawImagePath,
    });
  }

  return refs;
};

const normalizeAnnotation = (annotation) => {
  if (!annotation || typeof annotation !== "object") {
    return null;
  }

  if (annotation.type === "box") {
    return {
      id: typeof annotation.id === "string" ? annotation.id : crypto.randomUUID(),
      type: "box",
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

  if (annotation.type === "label") {
    return {
      id: typeof annotation.id === "string" ? annotation.id : crypto.randomUUID(),
      type: "label",
      x: Number(annotation.x) || 0,
      y: Number(annotation.y) || 0,
      text: typeof annotation.text === "string" ? annotation.text.trim() : "",
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
    outputImagePath: normalizePosixPath(manifest?.outputImagePath ?? normalized.outputImagePath),
    rawImagePath: normalizePosixPath(manifest?.rawImagePath ?? normalized.rawImagePath),
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
  const labelCount = list.filter((annotation) => annotation?.type === "label").length;

  return {
    totalCount: list.length,
    boxCount,
    arrowCount,
    labelCount,
  };
};

export const getTutorialShotAnnotationErrors = (annotations) => {
  const { boxCount, arrowCount, labelCount } = summarizeTutorialShotAnnotations(annotations);
  const errors = [];

  if (labelCount > 0) {
    errors.push("ラベルは使えません。削除して、必要なら枠と矢印で示してください。");
  }

  if (boxCount > MAX_TUTORIAL_BOX_COUNT) {
    errors.push("注目点を示す枠は 1 つだけにしてください。");
  }

  if (arrowCount > MAX_TUTORIAL_ARROW_COUNT) {
    errors.push("矢印は 1 本だけにしてください。");
  }

  if (boxCount === 0) {
    errors.push(
      arrowCount > 0
        ? "矢印だけは使えません。注目点を示す枠を 1 つ追加してください。"
        : "注目点を示す枠を 1 つ追加してください。",
    );
  }

  return errors;
};

export const getTutorialShotWarnings = (manifest) => {
  const annotations = Array.isArray(manifest?.annotations) ? manifest.annotations : [];
  return getTutorialShotAnnotationErrors(annotations);
};

const renderArrowHead = ({ fromX, fromY, toX, toY, strokeWidth }) => {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = Math.max(12, strokeWidth * 4);
  const spread = Math.PI / 8;
  const x1 = toX - headLength * Math.cos(angle - spread);
  const y1 = toY - headLength * Math.sin(angle - spread);
  const x2 = toX - headLength * Math.cos(angle + spread);
  const y2 = toY - headLength * Math.sin(angle + spread);

  return `${toX},${toY} ${x1},${y1} ${x2},${y2}`;
};

const estimateLabelWidth = (text, fontSize) => Math.max(44, fontSize * 0.64 * text.length + 20);

export const renderTutorialShotOverlaySvg = ({ width, height, annotations }) => {
  const shapes = [];

  for (const annotation of annotations ?? []) {
    if (annotation.type === "box") {
      shapes.push(
        `<rect x="${annotation.x}" y="${annotation.y}" width="${annotation.width}" height="${annotation.height}" rx="10" ry="10" fill="none" stroke="#ff6b00" stroke-width="4" />`,
      );
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

    if (annotation.type === "label") {
      const fontSize = 18;
      const labelWidth = estimateLabelWidth(annotation.text, fontSize);
      const labelHeight = 32;
      const rectY = annotation.y - labelHeight;
      shapes.push(
        `<rect x="${annotation.x}" y="${rectY}" width="${labelWidth}" height="${labelHeight}" rx="8" ry="8" fill="#111827" fill-opacity="0.92" />`,
      );
      shapes.push(
        `<text x="${annotation.x + 10}" y="${rectY + 21}" font-family="Arial, 'Noto Sans JP', sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${escapeXml(annotation.text)}</text>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join("")}</svg>`;
};

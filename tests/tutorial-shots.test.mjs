import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  applyTutorialShotStaticRasterOutputPolicy,
  createDefaultTutorialShotManifest,
  deriveTutorialShotRawImagePath,
  extractActionImageRefsFromMdx,
  extractVerifyImageRefsFromMdx,
  getTutorialShotGeneratedImageFormat,
  getTutorialShotImageContentType,
  getTutorialShotWarnings,
  isTutorialShotSourceImageFile,
  isTutorialShotSourceImageFileName,
  isTutorialShotSourceImageMimeType,
  renderTutorialShotOverlaySvg,
  TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION,
  TUTORIAL_SHOT_STATIC_RASTER_OUTPUT_FORMAT,
  TUTORIAL_SHOT_SOURCE_IMAGE_ACCEPT,
  TUTORIAL_SHOT_SOURCE_IMAGE_FORMAT_LABEL,
} from "../src/lib/tutorial-shots-shared.mjs";
import {
  getStoredTutorialShotCropState,
  getTutorialShotCropStateForImage,
  updateTutorialShotCropStateMap,
} from "../src/lib/tutorial-shot-editor-crop-state.mjs";
import {
  commitTutorialShotFiles,
  getTutorialShotArtifactIdentity,
  getTutorialShotAuthoringContext,
  readTutorialShotImage,
  saveTutorialShot as saveTutorialShotImpl,
  scanTutorialShots,
  tutorialShotRefsShareArtifacts,
} from "../src/lib/tutorial-shots-server.mjs";

const writeTutorialFixture = async (
  rootDir,
  { actionImageSrc = "./img/startup.png", imageFileName = "startup.png" } = {},
) => {
  const pageDir = path.join(rootDir, "content", "docs", "student-guide");
  const imageDir = path.join(pageDir, "img");
  await fs.mkdir(imageDir, { recursive: true });

  await fs.writeFile(
    path.join(pageDir, "index.mdx"),
    `---
title: Student Guide
---

<Section title="Step 1" goal="Unreal Editor を開いた状態">
  <Action img="${actionImageSrc}">
    **起動** を確認します
  </Action>
</Section>
`,
    "utf8",
  );

  const fixtureImage = sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: "#dbe4f0",
    },
  });
  const imagePath = path.join(imageDir, imageFileName);
  if (path.extname(imageFileName).toLowerCase() === ".webp") {
    await fixtureImage.webp({ lossless: true }).toFile(imagePath);
  } else {
    await fixtureImage.png().toFile(imagePath);
  }
};

const toTutorialShotSourceRef = (shot) => ({
  pagePath: shot.pagePath,
  tagName: shot.tagName,
  tagStart: shot.tagStart,
  tagEnd: shot.tagEnd,
  imgValueStart: shot.imgValueStart,
  imgValueEnd: shot.imgValueEnd,
  expectedImg: shot.expectedImg,
  pageRevision: shot.pageRevision,
  referenceKey: shot.referenceKey,
});

const getOnlyTutorialShotSourceRef = async (sourceRoot) => {
  const shots = await scanTutorialShots({ sourceRoot });
  assert.equal(shots.length, 1, "the fixture must contain exactly one tutorial shot reference");
  return toTutorialShotSourceRef(shots[0]);
};

const saveTutorialShot = async (options) =>
  saveTutorialShotImpl({
    ...options,
    sourceRef: options.sourceRef ?? (await getOnlyTutorialShotSourceRef(options.sourceRoot)),
  });

const writeDuplicateTutorialShotFixture = async (
  rootDir,
  { sameTagName = false, crossPage = false, withGeneratedFiles = false } = {},
) => {
  const pageDir = path.join(rootDir, "content", "docs", "student-guide");
  const imageDir = path.join(pageDir, "img");
  const shotsDir = path.join(pageDir, "shots");
  await fs.mkdir(imageDir, { recursive: true });

  const secondReference = sameTagName
    ? '<Action img="./img/compile-success.png">もう一度コンパイルします。</Action>'
    : '<Verify img="./img/compile-success.png">成功したことを確認します。</Verify>';
  await fs.writeFile(
    path.join(pageDir, "index.mdx"),
    `---
title: Student Guide
---

<Section title="Step 1" goal="コンパイル結果を確認する">
  <Action img="./img/compile-success.png" alt="compile result">
    コンパイルして、保存します。
  </Action>
  ${secondReference}
</Section>
`,
    "utf8",
  );

  const sourceImage = sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: "#dbe4f0",
    },
  });
  await sourceImage.png().toFile(path.join(imageDir, "compile-success.png"));

  if (crossPage) {
    const otherPageDir = path.join(rootDir, "content", "docs", "other-page");
    await fs.mkdir(otherPageDir, { recursive: true });
    await fs.writeFile(
      path.join(otherPageDir, "index.mdx"),
      `---
title: Other Page
---

<Section title="Step 2" goal="同じ結果を確認する">
  <Verify img="../student-guide/img/compile-success.png">同じ画像を確認します。</Verify>
</Section>
`,
      "utf8",
    );
  }

  if (!withGeneratedFiles) {
    return;
  }

  await fs.mkdir(shotsDir, { recursive: true });
  await sourceImage.webp({ lossless: true }).toFile(path.join(imageDir, "compile-success.webp"));
  await sourceImage.png().toFile(path.join(shotsDir, "compile-success.raw.png"));
  const manifest = {
    ...createDefaultTutorialShotManifest({
      pagePath: "content/docs/student-guide/index.mdx",
      outputImagePath: "content/docs/student-guide/img/compile-success.webp",
    }),
    rawImagePath: "content/docs/student-guide/shots/compile-success.raw.png",
    alt: "保存前の画像",
  };
  await fs.writeFile(
    path.join(shotsDir, "compile-success.shot.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
};

const writeArtifactCollisionFixture = async (rootDir, { kind }) => {
  const pageDir = path.join(rootDir, "content", "docs", "student-guide");
  const imageDir = path.join(pageDir, "img");
  const screensDir = path.join(pageDir, "screens");
  const shotsDir = path.join(pageDir, "shots");
  await Promise.all([
    fs.mkdir(imageDir, { recursive: true }),
    fs.mkdir(screensDir, { recursive: true }),
    fs.mkdir(shotsDir, { recursive: true }),
  ]);

  const isOutputPolicyCollision = kind === "output-policy";
  const actionSrc = "./img/result.png";
  const verifySrc = isOutputPolicyCollision ? "./img/result.webp" : "./screens/result.png";
  await fs.writeFile(
    path.join(pageDir, "index.mdx"),
    `---
title: Student Guide
---

<Section title="Step 1" goal="結果を確認する">
  <Action img="${actionSrc}">操作結果を保存します。</Action>
  <Verify img="${verifySrc}">保存結果を確認します。</Verify>
</Section>
`,
    "utf8",
  );

  const makeImage = (background) =>
    sharp({
      create: { width: 64, height: 48, channels: 4, background },
    });
  await makeImage("#2563eb").png().toFile(path.join(imageDir, "result.png"));
  await makeImage("#16a34a").webp({ lossless: true }).toFile(path.join(imageDir, "result.webp"));

  if (!isOutputPolicyCollision) {
    await makeImage("#9333ea").png().toFile(path.join(screensDir, "result.png"));
    await makeImage("#ea580c")
      .webp({ lossless: true })
      .toFile(path.join(screensDir, "result.webp"));
  }

  const rawExtension = isOutputPolicyCollision ? ".webp" : ".png";
  const rawPath = path.join(shotsDir, `result.raw${rawExtension}`);
  if (isOutputPolicyCollision) {
    await makeImage("#dc2626").webp({ lossless: true }).toFile(rawPath);
  } else {
    await makeImage("#dc2626").png().toFile(rawPath);
  }
  const manifest = {
    ...createDefaultTutorialShotManifest({
      pagePath: "content/docs/student-guide/index.mdx",
      outputImagePath: "content/docs/student-guide/img/result.webp",
    }),
    rawImagePath: `content/docs/student-guide/shots/result.raw${rawExtension}`,
    alt: "保存前の生成物",
  };
  const manifestPath = path.join(shotsDir, "result.shot.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    imageDir,
    manifestPath,
    pagePath: path.join(pageDir, "index.mdx"),
    rawPath,
    screensDir,
  };
};

const toDataUrl = (buffer, mimeType = "image/png") =>
  `data:${mimeType};base64,${buffer.toString("base64")}`;

const writeUInt24LE = (value) => {
  const buffer = Buffer.alloc(3);
  buffer.writeUIntLE(value, 0, 3);
  return buffer;
};

const createWebPChunk = (type, data) => {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32LE(data.length, 4);

  return Buffer.concat([header, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
};

const readWebPChunks = (webpBuffer) => {
  assert.equal(webpBuffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(webpBuffer.toString("ascii", 8, 12), "WEBP");

  const chunks = [];
  let offset = 12;
  while (offset + 8 <= webpBuffer.length) {
    const type = webpBuffer.toString("ascii", offset, offset + 4);
    const size = webpBuffer.readUInt32LE(offset + 4);
    chunks.push({
      type,
      data: webpBuffer.subarray(offset + 8, offset + 8 + size),
    });
    offset += 8 + size + (size % 2);
  }

  return chunks;
};

const createAnimatedWebPFixture = async ({ width, height, delays }) => {
  const frameBuffers = await Promise.all(
    ["#3366ff", "#22c55e"].map((background) =>
      sharp({
        create: {
          width,
          height,
          channels: 4,
          background,
        },
      })
        .webp({ lossless: true })
        .toBuffer(),
    ),
  );
  const vp8x = Buffer.concat([
    Buffer.from([0x12, 0, 0, 0]),
    writeUInt24LE(width - 1),
    writeUInt24LE(height - 1),
  ]);
  const animationHeader = Buffer.alloc(6);
  const animationChunks = frameBuffers.map((frameBuffer, index) => {
    const framePayload = Buffer.concat(
      readWebPChunks(frameBuffer)
        .filter((chunk) => ["ALPH", "VP8 ", "VP8L"].includes(chunk.type))
        .map((chunk) => createWebPChunk(chunk.type, chunk.data)),
    );
    const frameHeader = Buffer.concat([
      writeUInt24LE(0),
      writeUInt24LE(0),
      writeUInt24LE(width - 1),
      writeUInt24LE(height - 1),
      writeUInt24LE(delays[index]),
      Buffer.from([0x02]),
    ]);

    return createWebPChunk("ANMF", Buffer.concat([frameHeader, framePayload]));
  });
  const body = Buffer.concat([
    createWebPChunk("VP8X", vp8x),
    createWebPChunk("ANIM", animationHeader),
    ...animationChunks,
  ]);
  const riffHeader = Buffer.alloc(8);
  riffHeader.write("RIFF", 0, "ascii");
  riffHeader.writeUInt32LE(4 + body.length, 4);

  return Buffer.concat([riffHeader, Buffer.from("WEBP", "ascii"), body]);
};

test("tutorial shot source image accept contract lists browser-viewable image formats", () => {
  const acceptedTokens = TUTORIAL_SHOT_SOURCE_IMAGE_ACCEPT.split(",");

  for (const token of [
    "image/png",
    ".png",
    "image/apng",
    ".apng",
    "image/jpeg",
    ".jpg",
    ".jpeg",
    ".jfif",
    ".jpe",
    ".jif",
    "image/gif",
    ".gif",
    "image/webp",
    ".webp",
    "image/avif",
    ".avif",
    "image/svg+xml",
    ".svg",
    "image/bmp",
    "image/x-ms-bmp",
    ".bmp",
    ".dib",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/ico",
    "image/icon",
    "image/x-ico",
    "image/cursor",
    "image/x-cursor",
    ".ico",
    ".cur",
  ]) {
    assert.ok(acceptedTokens.includes(token), `accept should include ${token}`);
  }

  for (const token of [
    "image/tiff",
    ".tif",
    ".tiff",
    ".svgz",
    "image/heic",
    "image/heif",
    ".heic",
    ".heif",
    "image/jxl",
    ".jxl",
    "application/pdf",
    ".pdf",
  ]) {
    assert.equal(acceptedTokens.includes(token), false, `accept should exclude ${token}`);
  }

  assert.equal(
    TUTORIAL_SHOT_SOURCE_IMAGE_FORMAT_LABEL,
    "PNG/APNG/JPEG/GIF/WebP/AVIF/SVG/BMP/ICO/CUR",
  );
});

test("tutorial shot static raster output policy defaults generated images to lossless WebP", () => {
  assert.equal(TUTORIAL_SHOT_DEFAULT_OUTPUT_IMAGE_EXTENSION, ".webp");
  assert.equal(
    applyTutorialShotStaticRasterOutputPolicy("content/docs/tutorial/img/startup.png"),
    "content/docs/tutorial/img/startup.webp",
  );
  assert.deepEqual(TUTORIAL_SHOT_STATIC_RASTER_OUTPUT_FORMAT, {
    label: "WebP",
    mimeType: "image/webp",
    extension: ".webp",
    sharpFormat: "webp-lossless",
  });

  assert.deepEqual(getTutorialShotGeneratedImageFormat("content/docs/tutorial/img/startup.webp"), {
    label: "WebP",
    mimeType: "image/webp",
    extension: ".webp",
    sharpFormat: "webp-lossless",
  });
  assert.equal(
    getTutorialShotImageContentType("content/docs/tutorial/img/startup.webp"),
    "image/webp",
  );

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/tutorial/index.mdx",
    outputImagePath: "content/docs/tutorial/img/startup.webp",
  });
  assert.equal(manifest.rawImagePath, "content/docs/tutorial/shots/startup.raw.webp");
  assert.equal(
    deriveTutorialShotRawImagePath({
      pagePath: manifest.pagePath,
      outputImagePath: manifest.outputImagePath,
      sourceFileName: "source.PNG",
      mimeType: "image/png",
    }),
    "content/docs/tutorial/shots/startup.raw.png",
  );
});

test("tutorial shot source image helpers accept by MIME type or extension", () => {
  assert.equal(isTutorialShotSourceImageMimeType("image/avif"), true);
  assert.equal(isTutorialShotSourceImageMimeType("image/svg+xml; charset=utf-8"), true);
  assert.equal(isTutorialShotSourceImageMimeType("image/tiff"), false);

  assert.equal(isTutorialShotSourceImageFileName("screenshot.JFIF"), true);
  assert.equal(isTutorialShotSourceImageFileName("cursor.CUR"), true);
  assert.equal(isTutorialShotSourceImageFileName("compressed.svgz"), false);
  assert.equal(isTutorialShotSourceImageFileName("diagram.tiff"), false);

  assert.equal(
    isTutorialShotSourceImageFile({ name: "missing-type.avif", type: "" }),
    true,
    "empty MIME type should still pass when the extension is accepted",
  );
  assert.equal(
    isTutorialShotSourceImageFile({ name: "no-extension", type: "image/bmp" }),
    true,
    "accepted MIME type should pass even when the filename has no extension",
  );
  assert.equal(isTutorialShotSourceImageFile({ name: "photo.heic", type: "" }), false);
});

test("saveTutorialShot rejects non-image raw uploads before writing raw files", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-upload-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });
  const rawPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "startup.raw.png",
  );
  const sourceRef = await getOnlyTutorialShotSourceRef(sourceRoot);

  await assert.rejects(
    () =>
      saveTutorialShot({
        sourceRoot,
        sourceRef,
        manifestInput: manifest,
        rawImageDataUrl: toDataUrl(Buffer.from("not an image"), "text/plain"),
      }),
    /形式が対応していません/u,
  );
  await assert.rejects(() => fs.stat(rawPath), /ENOENT/u);
});

test("saveTutorialShot preserves raw PNG uploads and generates cropped annotated WebP output", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-upload-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot, {
    actionImageSrc: "./img/startup.webp",
    imageFileName: "startup.webp",
  });

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.webp",
  });
  const uploadedImageBuffer = await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: "#38bdf8",
    },
  })
    .png()
    .toBuffer();

  await saveTutorialShot({
    sourceRoot,
    sourceRef: await getOnlyTutorialShotSourceRef(sourceRoot),
    manifestInput: {
      ...manifest,
      crop: {
        x: 24,
        y: 20,
        width: 140,
        height: 90,
      },
      annotations: [
        {
          id: "box-1",
          type: "box",
          role: "action",
          x: 24,
          y: 20,
          width: 72,
          height: 36,
        },
      ],
    },
    rawImageDataUrl: toDataUrl(uploadedImageBuffer, "image/png"),
  });

  const rawPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "startup.raw.png",
  );
  const outputPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "img",
    "startup.webp",
  );
  const rawBytes = await fs.readFile(rawPath);
  assert.equal(Buffer.compare(rawBytes, uploadedImageBuffer), 0);

  const rawMetadata = await sharp(rawBytes).metadata();
  assert.equal(rawMetadata.format, "png");
  assert.equal(rawMetadata.width, 320);
  assert.equal(rawMetadata.height, 180);

  const outputBytes = await fs.readFile(outputPath);
  const outputMetadata = await sharp(outputBytes).metadata();
  assert.equal(outputMetadata.format, "webp");
  assert.equal(outputMetadata.width, 140);
  assert.equal(outputMetadata.height, 90);

  const { data, info } = await sharp(outputBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelOffset = (20 * info.width + 48) * info.channels;
  const strokePixel = Array.from(data.subarray(pixelOffset, pixelOffset + info.channels));
  assert.ok(
    strokePixel[0] >= 250 &&
      strokePixel[1] >= 95 &&
      strokePixel[1] <= 120 &&
      strokePixel[2] <= 20 &&
      strokePixel[3] === 255,
    `expected an orange annotation stroke pixel, got ${strokePixel.join(",")}`,
  );

  const outputImage = await readTutorialShotImage({
    sourceRoot,
    contentRelativePath: "content/docs/student-guide/img/startup.webp",
  });
  assert.equal(outputImage.contentType, "image/webp");

  const rawImage = await readTutorialShotImage({
    sourceRoot,
    contentRelativePath: "content/docs/student-guide/shots/startup.raw.png",
  });
  assert.equal(rawImage.contentType, "image/png");
});

test("saveTutorialShot preserves animated WebP uploads as cropped annotated animated WebP output", async (t) => {
  const sourceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "course-tutorial-shots-animated-webp-"),
  );

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot, {
    actionImageSrc: "./img/startup.webp",
    imageFileName: "startup.webp",
  });

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.webp",
  });
  const animatedWebPBuffer = await createAnimatedWebPFixture({
    width: 160,
    height: 100,
    delays: [60, 140],
  });
  const inputMetadata = await sharp(animatedWebPBuffer, { animated: true }).metadata();
  assert.equal(inputMetadata.format, "webp");
  assert.equal(inputMetadata.pages, 2);
  assert.deepEqual(inputMetadata.delay, [60, 140]);

  await saveTutorialShot({
    sourceRoot,
    sourceRef: await getOnlyTutorialShotSourceRef(sourceRoot),
    manifestInput: {
      ...manifest,
      crop: {
        x: 12,
        y: 10,
        width: 80,
        height: 50,
      },
      annotations: [
        {
          id: "box-1",
          type: "box",
          role: "action",
          x: 18,
          y: 16,
          width: 46,
          height: 24,
        },
      ],
    },
    rawImageDataUrl: toDataUrl(animatedWebPBuffer, "image/webp"),
    rawImageFileName: "startup.webp",
  });

  const rawPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "startup.raw.webp",
  );
  const outputPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "img",
    "startup.webp",
  );
  const rawBytes = await fs.readFile(rawPath);
  assert.equal(Buffer.compare(rawBytes, animatedWebPBuffer), 0);

  const outputBytes = await fs.readFile(outputPath);
  assert.notEqual(
    Buffer.compare(outputBytes, animatedWebPBuffer),
    0,
    "generated output must not pass through raw animated bytes",
  );
  const outputMetadata = await sharp(outputBytes, { animated: true }).metadata();
  assert.equal(outputMetadata.format, "webp");
  assert.equal(outputMetadata.pages, 2);
  assert.deepEqual(outputMetadata.delay, [60, 140]);
  assert.equal(outputMetadata.width, 80);
  assert.equal(outputMetadata.pageHeight, 50);

  const { data, info } = await sharp(outputBytes, { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const readFramePixel = (frameIndex, x, y) => {
    const frameTop = frameIndex * outputMetadata.pageHeight;
    const pixelOffset = ((frameTop + y) * info.width + x) * info.channels;
    return Array.from(data.subarray(pixelOffset, pixelOffset + info.channels));
  };
  assert.deepEqual(readFramePixel(0, 4, 4), [51, 102, 255, 255]);
  assert.deepEqual(readFramePixel(1, 4, 4), [34, 197, 94, 255]);

  for (const frameIndex of [0, 1]) {
    const strokePixel = readFramePixel(frameIndex, 40, 16);
    assert.ok(
      strokePixel[0] >= 250 &&
        strokePixel[1] >= 95 &&
        strokePixel[1] <= 120 &&
        strokePixel[2] <= 20 &&
        strokePixel[3] === 255,
      `expected an orange annotation stroke pixel on frame ${frameIndex}, got ${strokePixel.join(",")}`,
    );
  }

  const outputImage = await readTutorialShotImage({
    sourceRoot,
    contentRelativePath: "content/docs/student-guide/img/startup.webp",
  });
  assert.equal(outputImage.contentType, "image/webp");

  const rawImage = await readTutorialShotImage({
    sourceRoot,
    contentRelativePath: "content/docs/student-guide/shots/startup.raw.webp",
  });
  assert.equal(rawImage.contentType, "image/webp");
});

test("saveTutorialShot rejects MIME-spoofed unsupported raw uploads", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-upload-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });
  const tiffImageBuffer = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: "#f97316",
    },
  })
    .tiff()
    .toBuffer();
  const rawPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "startup.raw.png",
  );
  const sourceRef = await getOnlyTutorialShotSourceRef(sourceRoot);

  await assert.rejects(
    () =>
      saveTutorialShot({
        sourceRoot,
        sourceRef,
        manifestInput: manifest,
        rawImageDataUrl: toDataUrl(tiffImageBuffer, "image/png"),
      }),
    /形式が対応していません/u,
  );
  await assert.rejects(() => fs.stat(rawPath), /ENOENT/u);
});

test("extractActionImageRefsFromMdx derives output, raw, and manifest paths", () => {
  const refs = extractActionImageRefsFromMdx({
    pagePath: "content/docs/student-guide/index.mdx",
    sourceText: `
---
title: Tutorial
---

<Section title="Step 1" goal="ready">
  <Action img="./img/startup.png">A</Action>
  <Action img="https://example.com/external.png">B</Action>
  <Action img="./img/open-menu.webp">C</Action>
</Section>
`,
  });

  assert.deepEqual(
    refs.map((ref) => ({
      id: ref.id,
      outputImagePath: ref.outputImagePath,
      rawImagePath: ref.rawImagePath,
      manifestPath: ref.manifestPath,
    })),
    [
      {
        id: "startup",
        outputImagePath: "content/docs/student-guide/img/startup.webp",
        rawImagePath: "content/docs/student-guide/shots/startup.raw.png",
        manifestPath: "content/docs/student-guide/shots/startup.shot.json",
      },
      {
        id: "open-menu",
        outputImagePath: "content/docs/student-guide/img/open-menu.webp",
        rawImagePath: "content/docs/student-guide/shots/open-menu.raw.webp",
        manifestPath: "content/docs/student-guide/shots/open-menu.shot.json",
      },
    ],
  );
});

test("extractActionImageRefsFromMdx decodes URL-encoded Action image filenames", () => {
  const refs = extractActionImageRefsFromMdx({
    pagePath: "content/docs/student-guide/index.mdx",
    sourceText: `
---
title: Tutorial
---

<Section title="Step 1" goal="ready">
  <Action img="./img/node-Event%20ActorBeginOverlap.png">A</Action>
  <Action img="./img/connect-Score%2B1-SetScore.png">B</Action>
</Section>
`,
  });

  assert.deepEqual(
    refs.map((ref) => ({
      id: ref.id,
      sourceImagePath: ref.sourceImagePath,
      outputImagePath: ref.outputImagePath,
      rawImagePath: ref.rawImagePath,
      manifestPath: ref.manifestPath,
    })),
    [
      {
        id: "node-event-actorbeginoverlap",
        sourceImagePath: "img/node-Event ActorBeginOverlap.png",
        outputImagePath: "content/docs/student-guide/img/node-Event ActorBeginOverlap.webp",
        rawImagePath: "content/docs/student-guide/shots/node-Event ActorBeginOverlap.raw.png",
        manifestPath: "content/docs/student-guide/shots/node-Event ActorBeginOverlap.shot.json",
      },
      {
        id: "connect-score-1-setscore",
        sourceImagePath: "img/connect-Score+1-SetScore.png",
        outputImagePath: "content/docs/student-guide/img/connect-Score+1-SetScore.webp",
        rawImagePath: "content/docs/student-guide/shots/connect-Score+1-SetScore.raw.png",
        manifestPath: "content/docs/student-guide/shots/connect-Score+1-SetScore.shot.json",
      },
    ],
  );
});

test("extractVerifyImageRefsFromMdx derives output, raw, and manifest paths", () => {
  const refs = extractVerifyImageRefsFromMdx({
    pagePath: "content/docs/student-guide/index.mdx",
    sourceText: `
---
title: Tutorial
---

<Section title="Step 1" goal="ready">
  <Action img="./img/startup.png">A</Action>
  <Verify img="./img/result.png">画面がこの状態になれば成功</Verify>
  <Verify img="https://example.com/external.png">外部画像は除外</Verify>
  <Verify img="./img/done.webp">完了状態</Verify>
  <Verify>imgなしのVerifyは除外</Verify>
</Section>
`,
  });

  assert.deepEqual(
    refs.map((ref) => ({
      id: ref.id,
      outputImagePath: ref.outputImagePath,
      rawImagePath: ref.rawImagePath,
      manifestPath: ref.manifestPath,
    })),
    [
      {
        id: "result",
        outputImagePath: "content/docs/student-guide/img/result.webp",
        rawImagePath: "content/docs/student-guide/shots/result.raw.png",
        manifestPath: "content/docs/student-guide/shots/result.shot.json",
      },
      {
        id: "done",
        outputImagePath: "content/docs/student-guide/img/done.webp",
        rawImagePath: "content/docs/student-guide/shots/done.raw.webp",
        manifestPath: "content/docs/student-guide/shots/done.shot.json",
      },
    ],
  );
});

test("extractVerifyImageRefsFromMdx decodes URL-encoded Verify image filenames", () => {
  const refs = extractVerifyImageRefsFromMdx({
    pagePath: "content/docs/student-guide/index.mdx",
    sourceText: `
---
title: Tutorial
---

<Section title="Step 1" goal="ready">
  <Verify img="./img/result%20state.png">完了状態</Verify>
</Section>
`,
  });

  assert.deepEqual(
    refs.map((ref) => ({
      id: ref.id,
      sourceImagePath: ref.sourceImagePath,
      outputImagePath: ref.outputImagePath,
      rawImagePath: ref.rawImagePath,
      manifestPath: ref.manifestPath,
    })),
    [
      {
        id: "result-state",
        sourceImagePath: "img/result state.png",
        outputImagePath: "content/docs/student-guide/img/result state.webp",
        rawImagePath: "content/docs/student-guide/shots/result state.raw.png",
        manifestPath: "content/docs/student-guide/shots/result state.shot.json",
      },
    ],
  );
});

test("scanTutorialShots includes Verify img references alongside Action img references", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-shot-scan-"));

  try {
    const pageDir = path.join(rootDir, "content", "docs", "student-guide");
    const imageDir = path.join(pageDir, "img");
    await fs.mkdir(imageDir, { recursive: true });

    await fs.writeFile(
      path.join(pageDir, "index.mdx"),
      `---
title: Student Guide
---

<Section title="Step 1" goal="Unreal Editor を開いた状態">
  <Action img="./img/startup.png">
    **起動** を確認します
  </Action>
  <Verify img="./img/startup-result.png">画面がこの状態になれば成功</Verify>
</Section>
`,
      "utf8",
    );

    await sharp({
      create: { width: 640, height: 360, channels: 4, background: "#dbe4f0" },
    })
      .png()
      .toFile(path.join(imageDir, "startup.png"));

    await sharp({
      create: { width: 640, height: 360, channels: 4, background: "#e0f0db" },
    })
      .png()
      .toFile(path.join(imageDir, "startup-result.png"));

    const { scanTutorialShots } = await import("../src/lib/tutorial-shots-server.mjs");
    const shots = await scanTutorialShots({ sourceRoot: rootDir });

    assert.equal(shots.length, 2, "Action shot and Verify shot are both returned");

    const actionShot = shots.find((s) => s.id === "startup");
    const verifyShot = shots.find((s) => s.id === "startup-result");

    assert.ok(actionShot, "Action shot is present");
    assert.ok(verifyShot, "Verify shot is present");
    assert.equal(actionShot.outputImagePath, "content/docs/student-guide/img/startup.webp");
    assert.equal(verifyShot.outputImagePath, "content/docs/student-guide/img/startup-result.webp");
    assert.equal(actionShot.bootstrapImagePath, "content/docs/student-guide/img/startup.png");
    assert.equal(
      verifyShot.bootstrapImagePath,
      "content/docs/student-guide/img/startup-result.png",
    );
    assert.equal(actionShot.shotSource, "action", "Action shot has shotSource='action'");
    assert.equal(verifyShot.shotSource, "verify", "Verify shot has shotSource='verify'");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("scanTutorialShots returns distinct source references for Action and Verify tags sharing one image", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-shot-scan-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  await writeDuplicateTutorialShotFixture(sourceRoot);

  const shots = await scanTutorialShots({ sourceRoot });
  const pageSource = await fs.readFile(
    path.join(sourceRoot, "content", "docs", "student-guide", "index.mdx"),
    "utf8",
  );

  assert.equal(shots.length, 2);
  assert.equal(shots[0].outputImagePath, shots[1].outputImagePath);
  assert.equal(shots[0].bootstrapImagePath, shots[1].bootstrapImagePath);
  assert.notEqual(shots[0].referenceKey, shots[1].referenceKey);
  assert.deepEqual(
    shots.map((shot) => shot.tagName),
    ["Action", "Verify"],
  );
  for (const shot of shots) {
    assert.match(shot.pageRevision, /^[a-f0-9]{64}$/u);
    assert.match(shot.referenceKey, /^[a-f0-9]{64}$/u);
    assert.equal(shot.expectedImg, "./img/compile-success.png");
    assert.equal(
      pageSource.slice(shot.imgValueStart, shot.imgValueEnd),
      "./img/compile-success.png",
    );
    assert.match(
      pageSource.slice(shot.tagStart, shot.tagEnd),
      new RegExp(`^<${shot.tagName}\\b`, "u"),
    );
    assert.equal("occurrence" in shot, false);
  }
});

test("scanTutorialShots returns distinct source references for repeated tags of the same kind", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-action-shot-scan-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  await writeDuplicateTutorialShotFixture(sourceRoot, { sameTagName: true });

  const shots = await scanTutorialShots({ sourceRoot });

  assert.equal(shots.length, 2);
  assert.deepEqual(
    shots.map((shot) => shot.tagName),
    ["Action", "Action"],
  );
  assert.notEqual(shots[0].referenceKey, shots[1].referenceKey);
  assert.equal(
    shots.some((shot) => "occurrence" in shot),
    false,
  );
});

test("scanTutorialShots distinguishes references to one image from different pages", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cross-page-shot-scan-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  await writeDuplicateTutorialShotFixture(sourceRoot, { crossPage: true });

  const shots = await scanTutorialShots({ sourceRoot });
  const sharedImageShots = shots.filter(
    (shot) => shot.referencedImagePath === "content/docs/student-guide/img/compile-success.png",
  );

  assert.equal(sharedImageShots.length, 3);
  assert.equal(new Set(sharedImageShots.map((shot) => shot.referenceKey)).size, 3);
  assert.equal(new Set(sharedImageShots.map((shot) => shot.pagePath)).size, 2);
});

test("saveTutorialShot branches only the selected source reference when an image is shared", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-shot-save-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  await writeDuplicateTutorialShotFixture(sourceRoot, { withGeneratedFiles: true });

  const originalOutputPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "img",
    "compile-success.webp",
  );
  const originalRawPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "compile-success.raw.png",
  );
  const originalManifestPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "compile-success.shot.json",
  );
  const [originalOutput, originalRaw, originalManifest] = await Promise.all([
    fs.readFile(originalOutputPath),
    fs.readFile(originalRawPath),
    fs.readFile(originalManifestPath),
  ]);
  const initialShots = await scanTutorialShots({ sourceRoot });
  const actionShot = initialShots.find((shot) => shot.tagName === "Action");
  assert.ok(actionShot);

  const result = await saveTutorialShot({
    sourceRoot,
    sourceRef: toTutorialShotSourceRef(actionShot),
    manifestInput: {
      ...actionShot.manifest,
      alt: "分岐した Action 画像",
    },
  });

  assert.match(
    result.manifest.outputImagePath,
    /^content\/docs\/student-guide\/img\/compile-success--[a-f0-9]{6}\.webp$/u,
  );
  assert.match(
    result.manifest.rawImagePath,
    /^content\/docs\/student-guide\/shots\/compile-success--[a-f0-9]{6}\.raw\.png$/u,
  );
  assert.match(result.manifest.id, /^compile-success-[a-f0-9]{6}$/u);

  const savedPageSource = await fs.readFile(
    path.join(sourceRoot, "content", "docs", "student-guide", "index.mdx"),
    "utf8",
  );
  assert.match(
    savedPageSource,
    /<Action img="\.\/img\/compile-success--[a-f0-9]{6}\.webp" alt="compile result">/u,
  );
  assert.match(
    savedPageSource,
    /<Verify img="\.\/img\/compile-success\.png">成功したことを確認します。<\/Verify>/u,
  );

  const branchedOutputPath = path.join(sourceRoot, result.manifest.outputImagePath);
  const branchedRawPath = path.join(sourceRoot, result.manifest.rawImagePath);
  const branchedManifestPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    `${path.basename(result.manifest.outputImagePath, ".webp")}.shot.json`,
  );
  await Promise.all([
    fs.stat(branchedOutputPath),
    fs.stat(branchedRawPath),
    fs.stat(branchedManifestPath),
  ]);
  assert.deepEqual(await fs.readFile(originalOutputPath), originalOutput);
  assert.deepEqual(await fs.readFile(originalRawPath), originalRaw);
  assert.deepEqual(await fs.readFile(originalManifestPath), originalManifest);

  const rescannedShots = await scanTutorialShots({ sourceRoot });
  assert.equal(rescannedShots.length, 2);
  assert.equal(
    rescannedShots.some((shot) => shot.referenceKey === actionShot.referenceKey),
    false,
  );
  assert.equal(new Set(rescannedShots.map((shot) => shot.outputImagePath)).size, 2);
  assert.equal(result.sourceRef.referenceKey, rescannedShots[0].referenceKey);
});

test("saveTutorialShot branches when PNG and WebP references converge on the same generated artifacts", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "output-policy-collision-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  const fixture = await writeArtifactCollisionFixture(sourceRoot, { kind: "output-policy" });
  const originalPaths = [
    path.join(fixture.imageDir, "result.webp"),
    fixture.rawPath,
    fixture.manifestPath,
  ];
  const originalArtifacts = await Promise.all(
    originalPaths.map((artifactPath) => fs.readFile(artifactPath)),
  );
  const shots = await scanTutorialShots({ sourceRoot });
  const actionShot = shots.find((shot) => shot.tagName === "Action");
  assert.ok(actionShot);

  const result = await saveTutorialShot({
    sourceRoot,
    sourceRef: toTutorialShotSourceRef(actionShot),
    manifestInput: { ...actionShot.manifest, alt: "分岐した PNG 参照" },
  });

  assert.match(
    result.manifest.outputImagePath,
    /^content\/docs\/student-guide\/img\/result--[a-f0-9]{6}\.webp$/u,
  );
  assert.match(
    result.manifest.rawImagePath,
    /^content\/docs\/student-guide\/shots\/result--[a-f0-9]{6}\.raw\.webp$/u,
  );
  const savedPage = await fs.readFile(fixture.pagePath, "utf8");
  assert.match(savedPage, /<Action img="\.\/img\/result--[a-f0-9]{6}\.webp">/u);
  assert.match(savedPage, /<Verify img="\.\/img\/result\.webp">/u);
  const currentArtifacts = await Promise.all(
    originalPaths.map((artifactPath) => fs.readFile(artifactPath)),
  );
  assert.deepEqual(currentArtifacts, originalArtifacts);
});

test("saveTutorialShot branches when different image directories share manifest and raw artifacts", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "same-stem-collision-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  const fixture = await writeArtifactCollisionFixture(sourceRoot, { kind: "directories" });
  const originalPaths = [
    path.join(fixture.imageDir, "result.webp"),
    path.join(fixture.screensDir, "result.webp"),
    fixture.rawPath,
    fixture.manifestPath,
  ];
  const originalArtifacts = await Promise.all(
    originalPaths.map((artifactPath) => fs.readFile(artifactPath)),
  );
  const shots = await scanTutorialShots({ sourceRoot });
  const verifyShot = shots.find((shot) => shot.tagName === "Verify");
  assert.ok(verifyShot);
  assert.notEqual(shots[0].outputImagePath, shots[1].outputImagePath);
  assert.equal(shots[0].manifestPath, shots[1].manifestPath);
  assert.equal(shots[0].rawImagePath, shots[1].rawImagePath);

  const result = await saveTutorialShot({
    sourceRoot,
    sourceRef: toTutorialShotSourceRef(verifyShot),
    manifestInput: { ...verifyShot.manifest, alt: "分岐した別ディレクトリ参照" },
  });

  assert.match(
    result.manifest.outputImagePath,
    /^content\/docs\/student-guide\/screens\/result--[a-f0-9]{6}\.webp$/u,
  );
  assert.match(
    result.manifest.rawImagePath,
    /^content\/docs\/student-guide\/shots\/result--[a-f0-9]{6}\.raw\.png$/u,
  );
  const savedPage = await fs.readFile(fixture.pagePath, "utf8");
  assert.match(savedPage, /<Action img="\.\/img\/result\.png">/u);
  assert.match(savedPage, /<Verify img="\.\/screens\/result--[a-f0-9]{6}\.webp">/u);
  const currentArtifacts = await Promise.all(
    originalPaths.map((artifactPath) => fs.readFile(artifactPath)),
  );
  assert.deepEqual(currentArtifacts, originalArtifacts);
});

test("tutorial shot artifact identity is case-insensitive only for Windows semantics", () => {
  const sourceRoot = path.resolve("artifact-identity-root");
  const upperPath = "content/docs/Guide/img/Result.webp";
  const lowerPath = "content/docs/guide/img/result.webp";

  assert.equal(
    getTutorialShotArtifactIdentity({
      sourceRoot,
      contentRelativePath: upperPath,
      platform: "win32",
    }),
    getTutorialShotArtifactIdentity({
      sourceRoot,
      contentRelativePath: lowerPath,
      platform: "win32",
    }),
  );
  assert.notEqual(
    getTutorialShotArtifactIdentity({
      sourceRoot,
      contentRelativePath: upperPath,
      platform: "linux",
    }),
    getTutorialShotArtifactIdentity({
      sourceRoot,
      contentRelativePath: lowerPath,
      platform: "linux",
    }),
  );

  const upperRef = {
    pagePath: "content/docs/Guide/index.mdx",
    referencedImagePath: "content/docs/Guide/img/Result.png",
  };
  const lowerRef = {
    pagePath: "content/docs/guide/index.mdx",
    referencedImagePath: "content/docs/guide/img/result.png",
  };
  assert.equal(
    tutorialShotRefsShareArtifacts({
      sourceRoot,
      left: upperRef,
      right: lowerRef,
      platform: "win32",
    }),
    true,
  );
  assert.equal(
    tutorialShotRefsShareArtifacts({
      sourceRoot,
      left: upperRef,
      right: lowerRef,
      platform: "linux",
    }),
    false,
  );
});

test("commitTutorialShotFiles restores every changed target when the second install fails", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "shot-transaction-install-failure-"));
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const firstTarget = path.join(rootDir, "first.txt");
  const secondTarget = path.join(rootDir, "second.txt");
  await Promise.all([
    fs.writeFile(firstTarget, "old first", "utf8"),
    fs.writeFile(secondTarget, "old second", "utf8"),
  ]);
  let installCount = 0;
  const events = [];
  const fileOps = {
    ...fs,
    async rename(sourcePath, targetPath) {
      if (sourcePath.endsWith(".tmp")) {
        installCount += 1;
        events.push(`install:${installCount}:${targetPath}`);
        if (installCount === 2) {
          throw new Error("injected second install failure");
        }
      }
      return fs.rename(sourcePath, targetPath);
    },
  };

  await assert.rejects(
    () =>
      commitTutorialShotFiles(
        [
          { targetPath: firstTarget, data: "new first" },
          { targetPath: secondTarget, data: "new second" },
        ],
        { fileOps },
      ),
    /injected second install failure/u,
  );
  assert.deepEqual(events, [`install:1:${firstTarget}`, `install:2:${secondTarget}`]);
  assert.equal(await fs.readFile(firstTarget, "utf8"), "old first");
  assert.equal(await fs.readFile(secondTarget, "utf8"), "old second");
  assert.deepEqual(
    (await fs.readdir(rootDir)).filter((fileName) => /\.(?:tmp|bak)$/u.test(fileName)),
    [],
  );
});

test("commitTutorialShotFiles retains and reports a backup when restoration fails", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "shot-transaction-restore-failure-"));
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const firstTarget = path.join(rootDir, "first.txt");
  const secondTarget = path.join(rootDir, "second.txt");
  await Promise.all([
    fs.writeFile(firstTarget, "old first", "utf8"),
    fs.writeFile(secondTarget, "old second", "utf8"),
  ]);
  let installCount = 0;
  const fileOps = {
    ...fs,
    async rename(sourcePath, targetPath) {
      if (sourcePath.endsWith(".tmp")) {
        installCount += 1;
        if (installCount === 2) {
          throw new Error("injected second install failure");
        }
      }
      if (sourcePath.endsWith(".bak") && targetPath === firstTarget) {
        throw new Error("injected backup restore failure");
      }
      return fs.rename(sourcePath, targetPath);
    },
  };

  let transactionError;
  try {
    await commitTutorialShotFiles(
      [
        { targetPath: firstTarget, data: "new first" },
        { targetPath: secondTarget, data: "new second" },
      ],
      { fileOps },
    );
  } catch (error) {
    transactionError = error;
  }
  assert.ok(transactionError instanceof AggregateError);
  const retainedBackups = (await fs.readdir(rootDir))
    .filter((fileName) => fileName.endsWith(".bak"))
    .map((fileName) => path.join(rootDir, fileName));
  assert.equal(retainedBackups.length, 1);
  assert.equal(await fs.readFile(retainedBackups[0], "utf8"), "old first");
  assert.equal(
    transactionError.errors.some((error) => error.message.includes(retainedBackups[0])),
    true,
  );
  assert.equal(await fs.readFile(secondTarget, "utf8"), "old second");
  assert.deepEqual(
    (await fs.readdir(rootDir)).filter((fileName) => fileName.endsWith(".tmp")),
    [],
  );
});

test("commitTutorialShotFiles removes a newly created target without restoring a nonexistent backup", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "shot-transaction-new-target-"));
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const newTarget = path.join(rootDir, "new.txt");
  const existingTarget = path.join(rootDir, "existing.txt");
  await fs.writeFile(existingTarget, "old existing", "utf8");
  let installCount = 0;
  const restoredTargets = [];
  const fileOps = {
    ...fs,
    async rename(sourcePath, targetPath) {
      if (sourcePath.endsWith(".tmp")) {
        installCount += 1;
        if (installCount === 2) {
          throw new Error("injected second install failure");
        }
      }
      if (sourcePath.endsWith(".bak")) {
        restoredTargets.push(targetPath);
      }
      return fs.rename(sourcePath, targetPath);
    },
  };

  await assert.rejects(
    () =>
      commitTutorialShotFiles(
        [
          { targetPath: newTarget, data: "new file" },
          { targetPath: existingTarget, data: "new existing" },
        ],
        { fileOps },
      ),
    /injected second install failure/u,
  );
  await assert.rejects(fs.stat(newTarget), { code: "ENOENT" });
  assert.equal(await fs.readFile(existingTarget, "utf8"), "old existing");
  assert.deepEqual(restoredTargets, [existingTarget]);
  assert.deepEqual(
    (await fs.readdir(rootDir)).filter((fileName) => /\.(?:tmp|bak)$/u.test(fileName)),
    [],
  );
});

test("commitTutorialShotFiles reports cleanup warnings without rolling back installed targets", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "shot-transaction-cleanup-failure-"));
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const targetPath = path.join(rootDir, "target.txt");
  await fs.writeFile(targetPath, "old value", "utf8");
  const fileOps = {
    ...fs,
    async rm(cleanupPath, options) {
      if (cleanupPath.endsWith(".bak")) {
        throw new Error("injected backup cleanup failure");
      }
      return fs.rm(cleanupPath, options);
    },
  };

  const result = await commitTutorialShotFiles([{ targetPath, data: "new value" }], { fileOps });

  assert.equal(await fs.readFile(targetPath, "utf8"), "new value");
  const retainedBackup = (await fs.readdir(rootDir)).find((fileName) => fileName.endsWith(".bak"));
  assert.equal(typeof retainedBackup, "string");
  assert.equal(result.cleanupWarnings.length, 1);
  assert.match(result.cleanupWarnings[0], /injected backup cleanup failure/u);
  assert.equal(result.cleanupWarnings[0].includes(path.join(rootDir, retainedBackup)), true);
});

test("saveTutorialShot succeeds with a cleanup warning after every official file is installed", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shot-save-cleanup-warning-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  await writeTutorialFixture(sourceRoot);
  const [shot] = await scanTutorialShots({ sourceRoot });
  const fileOps = {
    ...fs,
    async rm(cleanupPath, options) {
      if (cleanupPath.endsWith(".bak")) {
        throw new Error("injected save cleanup failure");
      }
      return fs.rm(cleanupPath, options);
    },
  };

  const result = await saveTutorialShot({
    sourceRoot,
    sourceRef: toTutorialShotSourceRef(shot),
    manifestInput: { ...shot.manifest, alt: "cleanup warningでも保存成功" },
    bootstrapFromOutput: true,
    bootstrapImagePath: shot.bootstrapImagePath,
    fileOps,
  });

  assert.equal(result.manifest.alt, "cleanup warningでも保存成功");
  assert.equal(
    result.warnings.some((warning) => warning.includes("injected save cleanup failure")),
    true,
  );
  assert.match(await fs.readFile(path.join(sourceRoot, shot.pagePath), "utf8"), /startup\.webp/u);
  await Promise.all([
    fs.stat(path.join(sourceRoot, result.manifest.outputImagePath)),
    fs.stat(path.join(sourceRoot, result.manifest.rawImagePath)),
    fs.stat(path.join(sourceRoot, "content/docs/student-guide/shots/startup.shot.json")),
  ]);
});

test("saveTutorialShot reuses a branched path and its raw image on later edits", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "branched-shot-resave-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  await writeDuplicateTutorialShotFixture(sourceRoot, { withGeneratedFiles: true });

  const initialShots = await scanTutorialShots({ sourceRoot });
  const actionShot = initialShots.find((shot) => shot.tagName === "Action");
  assert.ok(actionShot);
  const firstSave = await saveTutorialShot({
    sourceRoot,
    sourceRef: toTutorialShotSourceRef(actionShot),
    manifestInput: {
      ...actionShot.manifest,
      alt: "最初の分岐保存",
    },
  });
  const branchedOutputPath = path.join(sourceRoot, firstSave.manifest.outputImagePath);
  const firstGeneratedOutput = await fs.readFile(branchedOutputPath);

  await sharp({
    create: { width: 640, height: 360, channels: 4, background: "#ef4444" },
  })
    .webp({ lossless: true })
    .toFile(branchedOutputPath);

  const rescannedShots = await scanTutorialShots({ sourceRoot });
  const branchedShot = rescannedShots.find(
    (shot) => shot.outputImagePath === firstSave.manifest.outputImagePath,
  );
  assert.ok(branchedShot);
  const secondSave = await saveTutorialShot({
    sourceRoot,
    sourceRef: toTutorialShotSourceRef(branchedShot),
    manifestInput: {
      ...branchedShot.manifest,
      alt: "再編集した分岐画像",
    },
  });

  assert.equal(secondSave.manifest.outputImagePath, firstSave.manifest.outputImagePath);
  assert.equal(secondSave.manifest.rawImagePath, firstSave.manifest.rawImagePath);
  assert.deepEqual(await fs.readFile(branchedOutputPath), firstGeneratedOutput);
  assert.doesNotMatch(secondSave.manifest.outputImagePath, /--[a-f0-9]{6}--/u);

  const imageFiles = await fs.readdir(
    path.join(sourceRoot, "content", "docs", "student-guide", "img"),
  );
  const shotFiles = await fs.readdir(
    path.join(sourceRoot, "content", "docs", "student-guide", "shots"),
  );
  assert.equal(
    imageFiles.filter((fileName) => /^compile-success--[a-f0-9]{6}\.webp$/u.test(fileName)).length,
    1,
  );
  assert.equal(
    shotFiles.filter((fileName) => /^compile-success--[a-f0-9]{6}\.shot\.json$/u.test(fileName))
      .length,
    1,
  );
  assert.equal(
    shotFiles.filter((fileName) => /^compile-success--[a-f0-9]{6}\.raw\.png$/u.test(fileName))
      .length,
    1,
  );
});

test("saveTutorialShot rejects a stale source reference before changing any artifact", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stale-shot-save-"));
  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });
  await writeDuplicateTutorialShotFixture(sourceRoot, { withGeneratedFiles: true });

  const initialShots = await scanTutorialShots({ sourceRoot });
  const actionShot = initialShots.find((shot) => shot.tagName === "Action");
  assert.ok(actionShot);
  const pagePath = path.join(sourceRoot, actionShot.pagePath);
  await fs.appendFile(pagePath, "\n{/* changed after scanning */}\n", "utf8");

  const artifactPaths = [
    pagePath,
    path.join(sourceRoot, actionShot.outputImagePath),
    path.join(sourceRoot, actionShot.rawImagePath),
    path.join(sourceRoot, actionShot.manifestPath),
  ];
  const before = await Promise.all(artifactPaths.map((artifactPath) => fs.readFile(artifactPath)));

  await assert.rejects(
    () =>
      saveTutorialShot({
        sourceRoot,
        sourceRef: toTutorialShotSourceRef(actionShot),
        manifestInput: {
          ...actionShot.manifest,
          alt: "この変更は保存されない",
        },
      }),
    (error) => {
      assert.equal(error?.statusCode, 409);
      assert.match(error?.message ?? "", /教材が更新されています/u);
      return true;
    },
  );

  const after = await Promise.all(artifactPaths.map((artifactPath) => fs.readFile(artifactPath)));
  assert.deepEqual(after, before);
});

test("getTutorialShotWarnings validates focal mode annotations", () => {
  const warnings = getTutorialShotWarnings({
    annotationMode: "focal",
    annotations: [
      {
        id: "box-1",
        type: "box",
        role: "action",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
      {
        id: "box-2",
        type: "box",
        role: "action",
        x: 20,
        y: 20,
        width: 10,
        height: 10,
      },
      { id: "arrow-1", type: "arrow", fromX: 0, fromY: 0, toX: 10, toY: 10 },
      { id: "arrow-2", type: "arrow", fromX: 4, fromY: 4, toX: 12, toY: 12 },
    ],
  });

  assert.deepEqual(warnings, [
    "注目点モードの枠は 1 つだけです。複数の場所を示すには同種複数か番号コールアウトモードに切り替えてください。",
    "矢印は 1 本だけにしてください。",
  ]);

  assert.deepEqual(
    getTutorialShotWarnings({
      annotations: [{ id: "arrow-only", type: "arrow", fromX: 10, fromY: 10, toX: 20, toY: 20 }],
    }),
    ["矢印だけは使えません。矢印を使うなら注目点を示す枠を 1 つ追加してください。"],
  );

  assert.deepEqual(getTutorialShotWarnings({ annotations: [] }), []);
});

test("getTutorialShotWarnings validates callout mode annotations", () => {
  assert.deepEqual(
    getTutorialShotWarnings({
      annotationMode: "callout",
      annotations: [
        { id: "box-1", type: "box", role: "action", x: 0, y: 0, width: 80, height: 40 },
        { id: "box-2", type: "box", role: "action", x: 100, y: 50, width: 80, height: 40 },
        { id: "box-3", type: "box", role: "action", x: 200, y: 100, width: 80, height: 40 },
      ],
    }),
    [],
    "callout mode allows multiple boxes",
  );

  assert.deepEqual(
    getTutorialShotWarnings({
      annotationMode: "callout",
      annotations: [
        { id: "box-1", type: "box", role: "action", x: 0, y: 0, width: 80, height: 40 },
        { id: "arrow-1", type: "arrow", fromX: 10, fromY: 10, toX: 20, toY: 20 },
      ],
    }),
    ["番号コールアウトモードでは矢印は使えません。不要な矢印を削除してください。"],
    "callout mode rejects arrows",
  );

  assert.deepEqual(
    getTutorialShotWarnings({
      annotationMode: "callout",
      annotations: [],
    }),
    [],
    "callout mode allows no annotations",
  );
});

test("getTutorialShotWarnings validates multi-focal mode annotations", () => {
  assert.deepEqual(
    getTutorialShotWarnings({
      annotationMode: "multi-focal",
      annotations: [
        { id: "box-1", type: "box", role: "action", x: 0, y: 0, width: 80, height: 40 },
        { id: "box-2", type: "box", role: "action", x: 100, y: 50, width: 80, height: 40 },
      ],
    }),
    [],
    "multi-focal mode allows multiple boxes",
  );

  assert.deepEqual(
    getTutorialShotWarnings({
      annotationMode: "multi-focal",
      annotations: [
        { id: "box-1", type: "box", role: "action", x: 0, y: 0, width: 80, height: 40 },
        { id: "arrow-1", type: "arrow", fromX: 10, fromY: 10, toX: 20, toY: 20 },
      ],
    }),
    ["同種複数モードでは矢印は使えません。不要な矢印を削除してください。"],
    "multi-focal mode rejects arrows",
  );
});

test("getTutorialShotWarnings emits verify-role warning for Verify shots with action annotations", () => {
  const actionBox = { id: "a1", type: "box", role: "action", x: 0, y: 0, width: 80, height: 40 };
  const verifyBox = { id: "v1", type: "box", role: "verify", x: 0, y: 0, width: 80, height: 40 };

  // Verify shot with an action box → warning
  const warnings = getTutorialShotWarnings(
    { annotationMode: "focal", annotations: [actionBox] },
    { shotSource: "verify" },
  );
  assert.ok(
    warnings.some((w) => w.includes("アクション（オレンジ実線）")),
    "Should warn about action role in a Verify shot",
  );

  // Verify shot with only verify boxes → no role warning
  assert.deepEqual(
    getTutorialShotWarnings(
      { annotationMode: "focal", annotations: [verifyBox] },
      { shotSource: "verify" },
    ),
    [],
    "Verify shot with only verify boxes should have no warnings",
  );

  // Action shot with an action box → no role warning (action boxes are fine)
  assert.deepEqual(
    getTutorialShotWarnings(
      { annotationMode: "focal", annotations: [actionBox] },
      { shotSource: "action" },
    ),
    [],
    "Action shot with action boxes should have no role warning",
  );

  // No shotSource option → backward-compatible, no role warning
  assert.deepEqual(
    getTutorialShotWarnings({ annotationMode: "focal", annotations: [actionBox] }),
    [],
    "Missing shotSource should not trigger role warning",
  );
});

test("tutorial shot editor crop state stays isolated per image and restores per selection", () => {
  let cropStates = {};

  cropStates = updateTutorialShotCropStateMap({
    currentCropStates: cropStates,
    shotKey: "content/docs/tutorial/img/startup.png",
    crop: {
      unit: "px",
      x: 12,
      y: 16,
      width: 240,
      height: 140,
    },
    completedCrop: {
      unit: "px",
      x: 12,
      y: 16,
      width: 240,
      height: 140,
    },
  });
  cropStates = updateTutorialShotCropStateMap({
    currentCropStates: cropStates,
    shotKey: "content/docs/tutorial/img/open-menu.png",
    crop: {
      unit: "px",
      x: 48,
      y: 24,
      width: 180,
      height: 96,
    },
    completedCrop: {
      unit: "px",
      x: 48,
      y: 24,
      width: 180,
      height: 96,
    },
  });

  assert.deepEqual(
    getStoredTutorialShotCropState({
      currentCropStates: cropStates,
      shotKey: "content/docs/tutorial/img/startup.png",
    }),
    {
      crop: {
        unit: "px",
        x: 12,
        y: 16,
        width: 240,
        height: 140,
      },
      completedCrop: {
        unit: "px",
        x: 12,
        y: 16,
        width: 240,
        height: 140,
      },
    },
  );
  assert.deepEqual(
    getStoredTutorialShotCropState({
      currentCropStates: cropStates,
      shotKey: "content/docs/tutorial/img/open-menu.png",
    }),
    {
      crop: {
        unit: "px",
        x: 48,
        y: 24,
        width: 180,
        height: 96,
      },
      completedCrop: {
        unit: "px",
        x: 48,
        y: 24,
        width: 180,
        height: 96,
      },
    },
  );

  assert.deepEqual(
    getTutorialShotCropStateForImage({
      currentCropStates: cropStates,
      shotKey: "content/docs/tutorial/img/startup.png",
      manifestCrop: {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
      },
      imageWidth: 640,
      imageHeight: 360,
    }),
    {
      crop: {
        unit: "px",
        x: 12,
        y: 16,
        width: 240,
        height: 140,
      },
      completedCrop: {
        unit: "px",
        x: 12,
        y: 16,
        width: 240,
        height: 140,
      },
    },
  );
  assert.deepEqual(
    getTutorialShotCropStateForImage({
      currentCropStates: cropStates,
      shotKey: "content/docs/tutorial/img/open-menu.png",
      manifestCrop: {
        x: 8,
        y: 8,
        width: 200,
        height: 120,
      },
      imageWidth: 640,
      imageHeight: 360,
    }),
    {
      crop: {
        unit: "px",
        x: 48,
        y: 24,
        width: 180,
        height: 96,
      },
      completedCrop: {
        unit: "px",
        x: 48,
        y: 24,
        width: 180,
        height: 96,
      },
    },
  );
  assert.deepEqual(
    getTutorialShotCropStateForImage({
      currentCropStates: cropStates,
      shotKey: "content/docs/tutorial/img/missing.png",
      manifestCrop: {
        x: 500,
        y: 300,
        width: 400,
        height: 200,
      },
      imageWidth: 640,
      imageHeight: 360,
    }),
    {
      crop: {
        unit: "px",
        x: 500,
        y: 300,
        width: 140,
        height: 60,
      },
      completedCrop: {
        unit: "px",
        x: 500,
        y: 300,
        width: 140,
        height: 60,
      },
    },
  );
});

test("scanTutorialShots and saveTutorialShot migrate static Action output to WebP", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const initialShots = await scanTutorialShots({ sourceRoot });
  assert.equal(initialShots.length, 1);
  assert.equal(initialShots[0].outputImagePath, "content/docs/student-guide/img/startup.webp");
  assert.equal(initialShots[0].bootstrapImagePath, "content/docs/student-guide/img/startup.png");
  assert.equal(initialShots[0].hasOutputImage, true);
  assert.equal(initialShots[0].hasRawImage, false);
  assert.equal(initialShots[0].hasManifest, false);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
    bootstrapImagePath: initialShots[0].bootstrapImagePath,
    manifestInput: {
      ...manifest,
      alt: "Epic Games Launcher の起動画面",
      crop: {
        x: 40,
        y: 30,
        width: 280,
        height: 160,
      },
      annotations: [
        {
          id: "box-1",
          type: "box",
          role: "action",
          x: 32,
          y: 24,
          width: 120,
          height: 64,
        },
        {
          id: "arrow-1",
          type: "arrow",
          fromX: 12,
          fromY: 20,
          toX: 44,
          toY: 40,
        },
      ],
    },
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.manifest.outputImagePath, manifest.outputImagePath);
  assert.equal(result.manifest.rawImagePath, manifest.rawImagePath);
  assert.ok(result.manifest.updatedAt);

  const rawImagePath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "startup.raw.png",
  );
  const manifestPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "startup.shot.json",
  );
  const outputImagePath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "img",
    "startup.webp",
  );

  await assert.doesNotReject(() => fs.stat(rawImagePath));
  await assert.doesNotReject(() => fs.stat(manifestPath));
  await assert.doesNotReject(() => fs.stat(outputImagePath));

  const savedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(savedManifest.alt, "Epic Games Launcher の起動画面");
  assert.deepEqual(savedManifest.crop, {
    x: 40,
    y: 30,
    width: 280,
    height: 160,
  });
  assert.deepEqual(savedManifest.annotations, [
    {
      id: "box-1",
      type: "box",
      role: "action",
      x: 32,
      y: 24,
      width: 120,
      height: 64,
    },
    {
      id: "arrow-1",
      type: "arrow",
      fromX: 12,
      fromY: 20,
      toX: 44,
      toY: 40,
    },
  ]);

  const outputBytes = await fs.readFile(outputImagePath);
  const outputMetadata = await sharp(outputBytes).metadata();
  assert.equal(outputMetadata.format, "webp");
  assert.equal(outputMetadata.width, 280);
  assert.equal(outputMetadata.height, 160);

  const savedPageSource = await fs.readFile(
    path.join(sourceRoot, "content", "docs", "student-guide", "index.mdx"),
    "utf8",
  );
  assert.match(savedPageSource, /<Action img="\.\/img\/startup\.webp">/u);

  const rescannedShots = await scanTutorialShots({ sourceRoot });
  assert.equal(rescannedShots.length, 1);
  assert.equal(rescannedShots[0].hasRawImage, true);
  assert.equal(rescannedShots[0].hasManifest, true);
  assert.deepEqual(rescannedShots[0].warnings, []);
});

test("scanTutorialShots and saveTutorialShot treat URL-encoded Action image filenames as real local files", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-encoded-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot, {
    actionImageSrc: "./img/node-Event%20ActorBeginOverlap.png",
    imageFileName: "node-Event ActorBeginOverlap.png",
  });

  const initialShots = await scanTutorialShots({ sourceRoot });
  assert.equal(initialShots.length, 1);
  assert.equal(
    initialShots[0].id,
    "node-event-actorbeginoverlap",
    "The shot id should come from the decoded filename, not the %20 escape.",
  );
  assert.equal(
    initialShots[0].outputImagePath,
    "content/docs/student-guide/img/node-Event ActorBeginOverlap.webp",
  );
  assert.equal(
    initialShots[0].bootstrapImagePath,
    "content/docs/student-guide/img/node-Event ActorBeginOverlap.png",
  );
  assert.equal(initialShots[0].hasOutputImage, true);

  const encodedPath = "content/docs/student-guide/img/node-Event%20ActorBeginOverlap.png";
  const decodedRawPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "node-Event ActorBeginOverlap.raw.png",
  );
  const encodedRawPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "node-Event%20ActorBeginOverlap.raw.png",
  );
  const decodedManifestPath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "shots",
    "node-Event ActorBeginOverlap.shot.json",
  );

  const image = await readTutorialShotImage({
    sourceRoot,
    contentRelativePath: encodedPath,
  });
  assert.equal(image.contentType, "image/png");
  assert.ok(image.bytes.length > 0);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: encodedPath,
  });
  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
    bootstrapImagePath: encodedPath,
    manifestInput: {
      ...manifest,
      crop: {
        x: 24,
        y: 20,
        width: 280,
        height: 160,
      },
      annotations: [],
    },
  });

  assert.equal(
    result.manifest.outputImagePath,
    "content/docs/student-guide/img/node-Event ActorBeginOverlap.webp",
  );
  assert.equal(
    result.manifest.rawImagePath,
    "content/docs/student-guide/shots/node-Event ActorBeginOverlap.raw.png",
  );
  await assert.doesNotReject(() => fs.stat(decodedRawPath));
  await assert.doesNotReject(() => fs.stat(decodedManifestPath));
  await assert.rejects(() => fs.stat(encodedRawPath));
});

test("saveTutorialShot expands the output canvas when annotations overflow the crop", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-overflow-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
    bootstrapImagePath: "content/docs/student-guide/img/startup.png",
    manifestInput: {
      ...manifest,
      crop: {
        x: 40,
        y: 30,
        width: 280,
        height: 160,
      },
      annotations: [
        {
          id: "box-left-top",
          type: "box",
          role: "action",
          x: -40,
          y: -20,
          width: 120,
          height: 64,
        },
      ],
    },
  });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.manifest.annotations, [
    {
      id: "box-left-top",
      type: "box",
      role: "action",
      x: -40,
      y: -20,
      width: 120,
      height: 64,
    },
  ]);

  const outputImagePath = path.join(
    sourceRoot,
    "content",
    "docs",
    "student-guide",
    "img",
    "startup.webp",
  );
  const outputBytes = await fs.readFile(outputImagePath);
  const outputMetadata = await sharp(outputBytes).metadata();
  assert.equal(outputMetadata.format, "webp");
  assert.equal(outputMetadata.width, 322);
  assert.equal(outputMetadata.height, 182);

  const { data, info } = await sharp(outputBytes).raw().toBuffer({ resolveWithObject: true });
  const readPixel = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    return Array.from(data.subarray(offset, offset + info.channels));
  };

  assert.equal(readPixel(0, 0)[3], 0, "Outside the shifted image should stay transparent.");
  assert.deepEqual(
    readPixel(42, 22),
    [219, 228, 240, 255],
    "The cropped screenshot should be shifted right/down instead of being clipped.",
  );
});

test("saveTutorialShot accepts no annotations for result-confirmation shots", async (t) => {
  const sourceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "course-tutorial-shots-no-annotations-"),
  );

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
    bootstrapImagePath: "content/docs/student-guide/img/startup.png",
    manifestInput: {
      ...manifest,
      crop: {
        x: 16,
        y: 16,
        width: 320,
        height: 180,
      },
      annotations: [],
    },
  });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.manifest.annotations, []);
});

test("saveTutorialShot accepts a single box without an arrow", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-box-only-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
    bootstrapImagePath: "content/docs/student-guide/img/startup.png",
    manifestInput: {
      ...manifest,
      crop: {
        x: 16,
        y: 16,
        width: 320,
        height: 180,
      },
      annotations: [
        {
          id: "box-1",
          type: "box",
          role: "action",
          x: 24,
          y: 24,
          width: 120,
          height: 64,
        },
      ],
    },
  });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.manifest.annotations, [
    {
      id: "box-1",
      type: "box",
      role: "action",
      x: 24,
      y: 24,
      width: 120,
      height: 64,
    },
  ]);
});

test("saveTutorialShot accepts multiple boxes in callout mode", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-callout-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
    bootstrapImagePath: "content/docs/student-guide/img/startup.png",
    manifestInput: {
      ...manifest,
      annotationMode: "callout",
      crop: {
        x: 16,
        y: 16,
        width: 320,
        height: 180,
      },
      annotations: [
        { id: "box-1", type: "box", role: "action", x: 10, y: 10, width: 80, height: 40 },
        { id: "box-2", type: "box", role: "action", x: 120, y: 60, width: 80, height: 40 },
        { id: "box-3", type: "box", role: "action", x: 220, y: 110, width: 80, height: 40 },
      ],
    },
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.manifest.annotationMode, "callout");
  assert.equal(result.manifest.annotations.length, 3);
});

test("saveTutorialShot rejects a box annotation without a role", async (t) => {
  const sourceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "course-tutorial-shots-role-missing-"),
  );

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  await assert.rejects(
    () =>
      saveTutorialShot({
        sourceRoot,
        bootstrapFromOutput: true,
        bootstrapImagePath: "content/docs/student-guide/img/startup.png",
        manifestInput: {
          ...manifest,
          annotationMode: "callout",
          crop: { x: 0, y: 0, width: 320, height: 180 },
          annotations: [{ id: "box-role-less", type: "box", x: 10, y: 10, width: 80, height: 40 }],
        },
      }),
    /role が必要です/u,
  );
});

test("renderTutorialShotOverlaySvg draws verify boxes with white dashed stroke and action boxes with orange solid stroke", () => {
  const svg = renderTutorialShotOverlaySvg({
    width: 200,
    height: 100,
    annotationMode: "callout",
    annotations: [
      { id: "a", type: "box", role: "action", x: 10, y: 10, width: 40, height: 20 },
      { id: "v", type: "box", role: "verify", x: 70, y: 40, width: 40, height: 20 },
    ],
  });

  // verify box: white (#ffffff) + dashed stroke
  const dashMatches = svg.match(/stroke-dasharray="12 8"/gu) ?? [];
  assert.equal(dashMatches.length, 1, "exactly one rect should be dashed (the verify one)");

  const verifyRectPattern =
    /<rect[^>]*x="70"[^>]*stroke="#ffffff"[^>]*stroke-dasharray="12 8"[^>]*\/>/u;
  assert.match(svg, verifyRectPattern, "verify rect must use white color with dashed stroke");

  // action box: orange (#ff6b00) + solid stroke
  const actionRectPattern = /<rect x="10"[^>]*stroke="#ff6b00"[^>]*stroke-width="4"\s*\/>/u;
  assert.match(
    svg,
    actionRectPattern,
    "action rect must use orange color without stroke-dasharray",
  );

  // verify badge: white fill, gray stroke/text
  const verifyBadgeCirclePattern = /<circle[^>]*fill="#ffffff"[^>]*stroke="#64748b"[^>]*\/>/u;
  assert.match(svg, verifyBadgeCirclePattern, "verify badge circle must be white-fill gray-stroke");

  const verifyBadgeTextPattern = /<text[^>]*fill="#64748b"[^>]*>2<\/text>/u;
  assert.match(svg, verifyBadgeTextPattern, "verify badge text must be gray");

  // action badge: orange fill, white text
  const actionBadgeCirclePattern = /<circle[^>]*fill="#ff6b00"[^>]*stroke="#ffffff"[^>]*\/>/u;
  assert.match(
    svg,
    actionBadgeCirclePattern,
    "action badge circle must be orange-fill white-stroke",
  );

  const actionBadgeTextPattern = /<text[^>]*fill="#ffffff"[^>]*>1<\/text>/u;
  assert.match(svg, actionBadgeTextPattern, "action badge text must be white");
});

test("saveTutorialShot rejects arrows in callout mode", async (t) => {
  const sourceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "course-tutorial-shots-callout-arrow-"),
  );

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  await assert.rejects(
    () =>
      saveTutorialShot({
        sourceRoot,
        bootstrapFromOutput: true,
        bootstrapImagePath: "content/docs/student-guide/img/startup.png",
        manifestInput: {
          ...manifest,
          annotationMode: "callout",
          crop: { x: 0, y: 0, width: 320, height: 180 },
          annotations: [
            { id: "box-1", type: "box", role: "action", x: 10, y: 10, width: 80, height: 40 },
            { id: "arrow-1", type: "arrow", fromX: 10, fromY: 10, toX: 40, toY: 30 },
          ],
        },
      }),
    /番号コールアウトモードでは矢印は使えません/u,
  );
});

test("saveTutorialShot accepts multiple boxes in multi-focal mode", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-multi-focal-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
    bootstrapImagePath: "content/docs/student-guide/img/startup.png",
    manifestInput: {
      ...manifest,
      annotationMode: "multi-focal",
      crop: {
        x: 16,
        y: 16,
        width: 320,
        height: 180,
      },
      annotations: [
        { id: "box-1", type: "box", role: "action", x: 10, y: 10, width: 80, height: 40 },
        { id: "box-2", type: "box", role: "action", x: 120, y: 60, width: 80, height: 40 },
      ],
    },
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.manifest.annotationMode, "multi-focal");
  assert.equal(result.manifest.annotations.length, 2);
});

test("saveTutorialShot rejects arrows in multi-focal mode", async (t) => {
  const sourceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "course-tutorial-shots-multi-focal-arrow-"),
  );

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  await assert.rejects(
    () =>
      saveTutorialShot({
        sourceRoot,
        bootstrapFromOutput: true,
        bootstrapImagePath: "content/docs/student-guide/img/startup.png",
        manifestInput: {
          ...manifest,
          annotationMode: "multi-focal",
          crop: { x: 0, y: 0, width: 320, height: 180 },
          annotations: [
            { id: "box-1", type: "box", role: "action", x: 10, y: 10, width: 80, height: 40 },
            { id: "arrow-1", type: "arrow", fromX: 10, fromY: 10, toX: 40, toY: 30 },
          ],
        },
      }),
    /同種複数モードでは矢印は使えません/u,
  );
});

test("saveTutorialShot rejects unsupported annotation combinations", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-limit-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const invalidScenarios = [
    {
      name: "arrow-only (focal)",
      annotations: [{ id: "arrow-1", type: "arrow", fromX: 16, fromY: 16, toX: 80, toY: 64 }],
      expectedMessage: /矢印だけは使えません/u,
    },
    {
      name: "multiple-boxes (focal)",
      annotations: [
        {
          id: "box-1",
          type: "box",
          role: "action",
          x: 16,
          y: 16,
          width: 80,
          height: 48,
        },
        {
          id: "box-2",
          type: "box",
          role: "action",
          x: 120,
          y: 64,
          width: 80,
          height: 48,
        },
      ],
      expectedMessage: /枠は 1 つだけ/u,
    },
    {
      name: "multiple-arrows (focal)",
      annotations: [
        {
          id: "box-1",
          type: "box",
          role: "action",
          x: 16,
          y: 16,
          width: 80,
          height: 48,
        },
        {
          id: "arrow-1",
          type: "arrow",
          fromX: 10,
          fromY: 10,
          toX: 48,
          toY: 40,
        },
        {
          id: "arrow-2",
          type: "arrow",
          fromX: 12,
          fromY: 12,
          toX: 54,
          toY: 44,
        },
      ],
      expectedMessage: /矢印は 1 本だけ/u,
    },
  ];

  for (const scenario of invalidScenarios) {
    await assert.rejects(
      () =>
        saveTutorialShot({
          sourceRoot,
          bootstrapFromOutput: true,
          manifestInput: {
            ...manifest,
            crop: {
              x: 0,
              y: 0,
              width: 320,
              height: 180,
            },
            annotations: scenario.annotations,
          },
        }),
      scenario.expectedMessage,
      scenario.name,
    );
  }
});

test("saveTutorialShot keeps reporting a missing raw image once annotations are valid", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-missing-raw-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot, {
    actionImageSrc: "./img/missing.png",
    imageFileName: "startup.png",
  });

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/missing.png",
  });

  await assert.rejects(
    () =>
      saveTutorialShot({
        sourceRoot,
        manifestInput: {
          ...manifest,
          crop: {
            x: 0,
            y: 0,
            width: 320,
            height: 180,
          },
          annotations: [
            {
              id: "box-1",
              type: "box",
              role: "action",
              x: 24,
              y: 24,
              width: 96,
              height: 64,
            },
          ],
        },
      }),
    /元画像がまだ無いため/u,
  );
});

test("getTutorialShotAuthoringContext accepts an explicit local override when COURSE_CONTENT_SOURCE is remote", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-context-"));
  const projectRoot = path.join(workspaceRoot, "course-docs-site");
  const localCourse = path.join(workspaceRoot, "open-campus-unreal-90min");

  t.after(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  await fs.mkdir(projectRoot, { recursive: true });
  await writeTutorialFixture(localCourse);
  await fs.writeFile(
    path.join(localCourse, "site.config.ts"),
    "export const siteConfig = {};\n",
    "utf8",
  );

  const disabledContext = await getTutorialShotAuthoringContext({
    env: {
      COURSE_CONTENT_SOURCE: "github:metyatech/javascript-course-docs#master",
    },
    projectRoot,
  });
  assert.equal(disabledContext.enabled, false);
  assert.equal(disabledContext.configuredSource, "github:metyatech/javascript-course-docs#master");
  assert.ok(disabledContext.suggestedLocalSources.includes("../open-campus-unreal-90min"));

  const enabledContext = await getTutorialShotAuthoringContext({
    env: {
      COURSE_CONTENT_SOURCE: "github:metyatech/javascript-course-docs#master",
    },
    projectRoot,
    requestedSource: "../open-campus-unreal-90min",
  });
  assert.equal(enabledContext.enabled, true);
  if (!enabledContext.enabled) {
    throw new Error("Expected the local override to enable tutorial shot authoring.");
  }
  assert.equal(enabledContext.sourceKind, "override");
  assert.equal(enabledContext.activeSourcePath, "../open-campus-unreal-90min");
  assert.equal(enabledContext.sourceRoot, localCourse);
});

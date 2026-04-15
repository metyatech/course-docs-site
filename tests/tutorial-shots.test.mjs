import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  createDefaultTutorialShotManifest,
  extractActionImageRefsFromMdx,
  getTutorialPageModeWarnings,
  getTutorialShotWarnings,
} from "../src/lib/tutorial-shots-shared.mjs";
import {
  getStoredTutorialShotCropState,
  getTutorialShotCropStateForImage,
  updateTutorialShotCropStateMap,
} from "../src/lib/tutorial-shot-editor-crop-state.mjs";
import {
  getTutorialShotAuthoringContext,
  readTutorialShotImage,
  saveTutorialShot,
  scanTutorialShots,
} from "../src/lib/tutorial-shots-server.mjs";

const writeTutorialFixture = async (
  rootDir,
  {
    actionImageSrc = "./img/startup.png",
    imageFileName = "startup.png",
  } = {},
) => {
  const pageDir = path.join(rootDir, "content", "docs", "student-guide");
  const imageDir = path.join(pageDir, "img");
  await fs.mkdir(imageDir, { recursive: true });

  await fs.writeFile(
    path.join(pageDir, "index.mdx"),
    `---
title: Student Guide
authoringMode: tutorial
---

<Section title="Step 1" goal="Unreal Editor を開いた状態">
  <Action img="${actionImageSrc}">
    **起動** を確認します
  </Action>
</Section>
`,
    "utf8",
  );

  await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: "#dbe4f0",
    },
  })
    .png()
    .toFile(path.join(imageDir, imageFileName));
};

test("extractActionImageRefsFromMdx derives output, raw, and manifest paths", () => {
  const refs = extractActionImageRefsFromMdx({
    pagePath: "content/docs/student-guide/index.mdx",
    sourceText: `
---
title: Tutorial
authoringMode: tutorial
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
        outputImagePath: "content/docs/student-guide/img/startup.png",
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
authoringMode: tutorial
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
        outputImagePath: "content/docs/student-guide/img/node-Event ActorBeginOverlap.png",
        rawImagePath: "content/docs/student-guide/shots/node-Event ActorBeginOverlap.raw.png",
        manifestPath: "content/docs/student-guide/shots/node-Event ActorBeginOverlap.shot.json",
      },
      {
        id: "connect-score-1-setscore",
        sourceImagePath: "img/connect-Score+1-SetScore.png",
        outputImagePath: "content/docs/student-guide/img/connect-Score+1-SetScore.png",
        rawImagePath: "content/docs/student-guide/shots/connect-Score+1-SetScore.raw.png",
        manifestPath: "content/docs/student-guide/shots/connect-Score+1-SetScore.shot.json",
      },
    ],
  );
});

test("getTutorialShotWarnings validates focal mode annotations", () => {
  const warnings = getTutorialShotWarnings({
    annotationMode: "focal",
    annotations: [
      {
        id: "box-1",
        type: "box",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
      {
        id: "box-2",
        type: "box",
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
    "注目点モードの枠は 1 つだけです。複数の場所を示すには番号コールアウトモードに切り替えてください。",
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
        { id: "box-1", type: "box", x: 0, y: 0, width: 80, height: 40 },
        { id: "box-2", type: "box", x: 100, y: 50, width: 80, height: 40 },
        { id: "box-3", type: "box", x: 200, y: 100, width: 80, height: 40 },
      ],
    }),
    [],
    "callout mode allows multiple boxes",
  );

  assert.deepEqual(
    getTutorialShotWarnings({
      annotationMode: "callout",
      annotations: [
        { id: "box-1", type: "box", x: 0, y: 0, width: 80, height: 40 },
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

test("getTutorialPageModeWarnings warns when a Section page omits authoringMode", () => {
  const warnings = getTutorialPageModeWarnings({
    sourceText: `---
title: Tutorial
---

<Section title="Step 1" goal="ready">
  <Action img="./img/startup.png">A</Action>
</Section>
`,
  });

  assert.deepEqual(warnings, [
    "このページは <Section> を使っていますが `authoringMode: tutorial` がありません。course-docs-platform の新ルールに合わせて frontmatter か metadata export に追加してください。",
  ]);
});

test("getTutorialPageModeWarnings stays quiet for tutorial pages with authoringMode", () => {
  const warnings = getTutorialPageModeWarnings({
    sourceText: `---
title: Tutorial
authoringMode: tutorial
---

<Section title="Step 1" goal="ready">
  <Action img="./img/startup.png">A</Action>
</Section>
`,
  });

  assert.deepEqual(warnings, []);
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

test("scanTutorialShots and saveTutorialShot keep Action img output paths stable", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  await writeTutorialFixture(sourceRoot);

  const initialShots = await scanTutorialShots({ sourceRoot });
  assert.equal(initialShots.length, 1);
  assert.equal(initialShots[0].outputImagePath, "content/docs/student-guide/img/startup.png");
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
    "startup.png",
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

  const outputMetadata = await sharp(outputImagePath).metadata();
  assert.equal(outputMetadata.width, 280);
  assert.equal(outputMetadata.height, 160);

  const rescannedShots = await scanTutorialShots({ sourceRoot });
  assert.equal(rescannedShots.length, 1);
  assert.equal(rescannedShots[0].hasRawImage, true);
  assert.equal(rescannedShots[0].hasManifest, true);
  assert.deepEqual(rescannedShots[0].warnings, []);
});

test("scanTutorialShots warns when a tutorial page still lacks authoringMode", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-mode-warning-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  const pageDir = path.join(sourceRoot, "content", "docs", "student-guide");
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
</Section>
`,
    "utf8",
  );
  await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: "#dbe4f0",
    },
  })
    .png()
    .toFile(path.join(imageDir, "startup.png"));

  const shots = await scanTutorialShots({ sourceRoot });

  assert.equal(shots.length, 1);
  assert.deepEqual(shots[0].warnings, [
    "このページは <Section> を使っていますが `authoringMode: tutorial` がありません。course-docs-platform の新ルールに合わせて frontmatter か metadata export に追加してください。",
  ]);
});

test("saveTutorialShot keeps returning the page-mode warning until authoringMode is added", async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shots-save-warning-"));

  t.after(async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  const pageDir = path.join(sourceRoot, "content", "docs", "student-guide");
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
</Section>
`,
    "utf8",
  );
  await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: "#dbe4f0",
    },
  })
    .png()
    .toFile(path.join(imageDir, "startup.png"));

  const manifest = createDefaultTutorialShotManifest({
    pagePath: "content/docs/student-guide/index.mdx",
    outputImagePath: "content/docs/student-guide/img/startup.png",
  });

  const result = await saveTutorialShot({
    sourceRoot,
    bootstrapFromOutput: true,
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

  assert.deepEqual(result.warnings, [
    "このページは <Section> を使っていますが `authoringMode: tutorial` がありません。course-docs-platform の新ルールに合わせて frontmatter か metadata export に追加してください。",
  ]);
});

test(
  "scanTutorialShots and saveTutorialShot treat URL-encoded Action image filenames as real local files",
  async (t) => {
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
      "content/docs/student-guide/img/node-Event ActorBeginOverlap.png",
    );
    assert.equal(
      result.manifest.rawImagePath,
      "content/docs/student-guide/shots/node-Event ActorBeginOverlap.raw.png",
    );
    await assert.doesNotReject(() => fs.stat(decodedRawPath));
    await assert.doesNotReject(() => fs.stat(decodedManifestPath));
    await assert.rejects(() => fs.stat(encodedRawPath));
  },
);

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
    "startup.png",
  );
  const outputMetadata = await sharp(outputImagePath).metadata();
  assert.equal(outputMetadata.width, 322);
  assert.equal(outputMetadata.height, 182);

  const { data, info } = await sharp(outputImagePath)
    .raw()
    .toBuffer({ resolveWithObject: true });
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
        { id: "box-1", type: "box", x: 10, y: 10, width: 80, height: 40 },
        { id: "box-2", type: "box", x: 120, y: 60, width: 80, height: 40 },
        { id: "box-3", type: "box", x: 220, y: 110, width: 80, height: 40 },
      ],
    },
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.manifest.annotationMode, "callout");
  assert.equal(result.manifest.annotations.length, 3);
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
        manifestInput: {
          ...manifest,
          annotationMode: "callout",
          crop: { x: 0, y: 0, width: 320, height: 180 },
          annotations: [
            { id: "box-1", type: "box", x: 10, y: 10, width: 80, height: 40 },
            { id: "arrow-1", type: "arrow", fromX: 10, fromY: 10, toX: 40, toY: 30 },
          ],
        },
      }),
    /番号コールアウトモードでは矢印は使えません/u,
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
          x: 16,
          y: 16,
          width: 80,
          height: 48,
        },
        {
          id: "box-2",
          type: "box",
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

  await writeTutorialFixture(sourceRoot);

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

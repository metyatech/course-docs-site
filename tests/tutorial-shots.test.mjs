import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  createDefaultTutorialShotManifest,
  extractActionImageRefsFromMdx,
  getTutorialShotWarnings,
} from "../src/lib/tutorial-shots-shared.mjs";
import {
  getStoredTutorialShotCropState,
  getTutorialShotCropStateForImage,
  updateTutorialShotCropStateMap,
} from "../src/lib/tutorial-shot-editor-crop-state.mjs";
import {
  getTutorialShotAuthoringContext,
  saveTutorialShot,
  scanTutorialShots,
} from "../src/lib/tutorial-shots-server.mjs";

const writeTutorialFixture = async (rootDir) => {
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
};

test("extractActionImageRefsFromMdx derives output, raw, and manifest paths", () => {
  const refs = extractActionImageRefsFromMdx({
    pagePath: "content/docs/student-guide/index.mdx",
    sourceText: `
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

test("getTutorialShotWarnings allows no annotations but rejects invalid callouts", () => {
  const warnings = getTutorialShotWarnings({
    annotations: [
      { id: "legacy-label", type: "label", x: 10, y: 10, text: "Play" },
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
    "ラベルは使えません。削除して、必要なら枠と矢印で示してください。",
    "注目点を示す枠は 1 つだけにしてください。",
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
      name: "label",
      annotations: [{ id: "legacy-label", type: "label", x: 16, y: 16, text: "Play" }],
      expectedMessage: /ラベルは使えません/u,
    },
    {
      name: "arrow-only",
      annotations: [{ id: "arrow-1", type: "arrow", fromX: 16, fromY: 16, toX: 80, toY: 64 }],
      expectedMessage: /矢印だけは使えません/u,
    },
    {
      name: "multiple-boxes",
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
      name: "multiple-arrows",
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

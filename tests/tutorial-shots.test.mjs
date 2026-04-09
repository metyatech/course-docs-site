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
import { saveTutorialShot, scanTutorialShots } from "../src/lib/tutorial-shots-server.mjs";

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

test("getTutorialShotWarnings flags redundant screenshot text and overly dense annotations", () => {
  const warnings = getTutorialShotWarnings({
    annotations: [
      { id: "1", type: "label", x: 10, y: 10, text: "ここをクリックします。" },
      {
        id: "long-label",
        type: "label",
        x: 20,
        y: 20,
        text: "This label is intentionally far too long for a tutorial screenshot",
      },
      { id: "2", type: "box", x: 0, y: 0, width: 10, height: 10 },
      { id: "3", type: "box", x: 0, y: 0, width: 10, height: 10 },
      { id: "4", type: "box", x: 0, y: 0, width: 10, height: 10 },
      { id: "5", type: "box", x: 0, y: 0, width: 10, height: 10 },
    ],
  });

  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((warning) => /Annotations exceed 4/i.test(warning)));
  assert.ok(warnings.some((warning) => /too long/i.test(warning)));
  assert.ok(warnings.some((warning) => /instruction sentence/i.test(warning)));
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
          id: "label-1",
          type: "label",
          x: 16,
          y: 40,
          text: "Play",
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

  const outputMetadata = await sharp(outputImagePath).metadata();
  assert.equal(outputMetadata.width, 280);
  assert.equal(outputMetadata.height, 160);

  const rescannedShots = await scanTutorialShots({ sourceRoot });
  assert.equal(rescannedShots.length, 1);
  assert.equal(rescannedShots[0].hasRawImage, true);
  assert.equal(rescannedShots[0].hasManifest, true);
  assert.deepEqual(rescannedShots[0].warnings, []);
});

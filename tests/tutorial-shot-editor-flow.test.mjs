import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { TUTORIAL_SHOT_EDITOR_WORKSPACE_PADDING } from "../src/lib/tutorial-shots-shared.mjs";
import { createRunDevTestEnv, killProcessTree } from "./test-harness-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envCourseLocalPath = path.join(projectRoot, ".env.course.local");

const fileExists = async (targetPath) => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const backupFile = async (targetPath) => {
  if (!(await fileExists(targetPath))) {
    return null;
  }

  return fs.readFile(targetPath, "utf8");
};

const restoreFile = async (targetPath, contentsOrNull) => {
  if (contentsOrNull === null) {
    await fs.rm(targetPath, { force: true });
    return;
  }

  await fs.writeFile(targetPath, contentsOrNull, "utf8");
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate free port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (fn, { timeoutMs, intervalMs, onTimeoutMessage }) => {
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(onTimeoutMessage ?? "Timed out");
    }
    const result = await fn();
    if (result) {
      return;
    }
    await sleep(intervalMs);
  }
};

const tryFetchStatus = async (url) => {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return response.status;
  } catch {
    return null;
  }
};

const writeFixtureCourseRepo = async (
  rootDir,
  {
    logoText = "Tutorial Shot Fixture",
    firstImageName = "startup",
    secondImageName = "missing-output",
    firstActionImageSrc = `./img/${firstImageName}.png`,
    secondActionImageSrc = `./img/${secondImageName}.png`,
    firstImageFileName = `${firstImageName}.png`,
  } = {},
) => {
  const siteConfig = `export const siteConfig = {
  logoText: ${JSON.stringify(logoText)},
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "tutorial shot editor fixture",
  faviconHref: "/img/favicon.ico",
} as const;
`;

  const rootMeta = `const meta = {
  "*": {
    type: "page",
    theme: {
      timestamp: false
    }
  },
  index: {
    display: "hidden"
  },
  docs: "Docs",
};

export default meta;
`;

  const docsMeta = `const meta = {
  tutorial: {},
};

export default meta;
`;

  const tutorialPage = `---
title: Tutorial
authoringMode: tutorial
---

<Section title="Step 1" goal="最初のショットを保存できる状態">
  <Action img="${firstActionImageSrc}">
    **${firstImageName}** を確認します
  </Action>
  <Action img="${secondActionImageSrc}">
    **${secondImageName}** を確認します
  </Action>
</Section>

![保存反映確認](./img/${firstImageFileName})
`;

  const pageDir = path.join(rootDir, "content", "docs", "tutorial");
  const imageDir = path.join(pageDir, "img");

  await fs.mkdir(imageDir, { recursive: true });
  await fs.mkdir(path.join(rootDir, "public", "img"), { recursive: true });

  await fs.writeFile(path.join(rootDir, "site.config.ts"), siteConfig, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "_meta.ts"), rootMeta, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "docs", "_meta.ts"), docsMeta, "utf8");
  await fs.writeFile(path.join(pageDir, "index.mdx"), tutorialPage, "utf8");
  await fs.writeFile(path.join(rootDir, "public", "img", "favicon.ico"), "", "utf8");

  await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: "#cbd5e1",
    },
  })
    .png()
    .toFile(path.join(imageDir, firstImageFileName));
};

const sha256File = async (filePath) => {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
};

const createSolidPngBuffer = async ({ background = "#38bdf8", width = 640, height = 360 } = {}) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .png()
    .toBuffer();

const toDataUrl = (buffer, mimeType = "image/png") =>
  `data:${mimeType};base64,${buffer.toString("base64")}`;

const getAnnotationCanvas = (page) =>
  page.locator('[data-testid="annotation-stage"] canvas').first();

const annotationWorkspacePadding = TUTORIAL_SHOT_EDITOR_WORKSPACE_PADDING;

const getAnnotationCanvasBox = async (page) => {
  const canvasBox = await getAnnotationCanvas(page).boundingBox();
  assert.ok(canvasBox, "Annotation canvas should have a bounding box.");
  return canvasBox;
};

const waitForAnnotationCanvasReady = async (page) => {
  await waitFor(
    async () =>
      page.evaluate(() => {
        const stage = document.querySelector('[data-testid="annotation-stage"]');
        const canvas = stage?.querySelector("canvas");
        if (!stage || !canvas) {
          return false;
        }

        const stageRect = stage.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        return canvasRect.left >= stageRect.left + 10;
      }),
    {
      timeoutMs: 30_000,
      intervalMs: 200,
      onTimeoutMessage: "Annotation canvas left edge stayed clipped.",
    },
  );
};

const openTutorialShotEditor = async (
  page,
  overrideCourseRelativePath,
  { firstShotButtonName = /override-startup/i } = {},
) => {
  await page.goto("/dev/tutorial-shots/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "チュートリアル画像エディタ" }).waitFor();
  await page.getByRole("button", { name: "別のリポジトリに切り替え" }).click();
  await page.getByPlaceholder("../open-campus-unreal-90min").fill(overrideCourseRelativePath);
  await page.getByRole("button", { name: "切り替える" }).click();
  // The server rescans the override-course directory on click; on Windows
  // this can exceed Playwright's 30 s default under heavy disk/CPU load.
  await page.getByRole("button", { name: firstShotButtonName }).waitFor({ timeout: 60_000 });
  await page.getByRole("heading", { name: "必要なら注釈を追加" }).scrollIntoViewIfNeeded();
  await waitForAnnotationCanvasReady(page);
};

const pasteImageIntoEditor = async (page, imageDataUrl) => {
  await page.evaluate(async (dataUrl) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], "clipboard.png", { type: blob.type || "image/png" });
    const clipboardData = new DataTransfer();
    clipboardData.items.add(file);
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: clipboardData,
    });
    window.dispatchEvent(pasteEvent);
  }, imageDataUrl);
};

const getPreviewProbeImage = (page) => page.locator('img[alt="保存反映確認"]:visible').first();

const isTutorialShotHighlightPixel = (pixel) =>
  Array.isArray(pixel) &&
  pixel.length === 4 &&
  pixel[0] >= 250 &&
  pixel[1] >= 100 &&
  pixel[1] <= 110 &&
  pixel[2] <= 10 &&
  pixel[3] === 255;

const readPreviewProbePixel = async (page, { x = 8, y = 8 } = {}) =>
  getPreviewProbeImage(page).evaluate((image, coordinates) => {
    if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(coordinates.x, coordinates.y, 1, 1).data);
  }, { x, y });

test(
  "tutorial shot editor saves one boxed focal point with an optional arrow",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shot-editor-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const overrideCourse = path.join(tempRoot, "override-course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    await writeFixtureCourseRepo(overrideCourse, {
      logoText: "Override Tutorial Shot Fixture",
      firstImageName: "override-startup",
      secondImageName: "override-missing-output",
    });

    const startupOutputPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "img",
      "override-startup.png",
    );
    const startupOutputHashBefore = await sha256File(startupOutputPath);
    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-flow",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
    });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath);

    await page.getByLabel("画像の説明（Alt テキスト）").fill("起動画面");
    await assert.equal(
      await page.getByRole("button", { name: "保存", exact: true }).isDisabled(),
      false,
    );
    await assert.equal(await page.getByRole("button", { name: "矢印を追加" }).isDisabled(), true);
    await assert.equal(await page.getByRole("button", { name: "ラベルを追加" }).count(), 0);
    await page.getByText("特に示したい場所がなければ、このまま保存できます。").waitFor();

    await page.getByRole("button", { name: "枠を追加" }).click();
    await assert.equal(await page.getByRole("button", { name: "枠を追加" }).isDisabled(), true);
    await assert.equal(await page.getByRole("button", { name: "矢印を追加" }).isDisabled(), false);
    await assert.equal(
      await page.getByRole("button", { name: "保存", exact: true }).isDisabled(),
      false,
    );

    await page.getByRole("button", { name: "矢印を追加" }).click();
    await assert.equal(await page.getByRole("button", { name: "矢印を追加" }).isDisabled(), true);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存しました").waitFor();

    const startupRawPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override-startup.raw.png",
    );
    const startupManifestPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override-startup.shot.json",
    );

    await assert.doesNotReject(() => fs.stat(startupRawPath));
    await assert.doesNotReject(() => fs.stat(startupManifestPath));

    const startupManifest = JSON.parse(await fs.readFile(startupManifestPath, "utf8"));
    assert.equal(startupManifest.alt, "起動画面");
    assert.deepEqual(startupManifest.annotations, [
      {
        id: startupManifest.annotations[0].id,
        type: "box",
        role: "action",
        x: 128,
        y: 72,
        width: 224,
        height: 65,
      },
      {
        id: startupManifest.annotations[1].id,
        type: "arrow",
        fromX: 72,
        fromY: 32,
        toX: 173,
        toY: 85,
      },
    ]);

    const startupOutputHashAfter = await sha256File(startupOutputPath);
    assert.notEqual(startupOutputHashAfter, startupOutputHashBefore);

    const startupRawHash = await sha256File(startupRawPath);
    assert.equal(startupRawHash, startupOutputHashBefore);
  },
);

test(
  "tutorial shot editor can edit an Action image whose filename contains spaces",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shot-editor-space-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const overrideCourse = path.join(tempRoot, "override-course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    await writeFixtureCourseRepo(overrideCourse, {
      logoText: "Override Tutorial Shot Fixture",
      firstImageName: "override Event ActorBeginOverlap",
      firstActionImageSrc: "./img/override%20Event%20ActorBeginOverlap.png",
      firstImageFileName: "override Event ActorBeginOverlap.png",
      secondImageName: "override-missing-output",
    });

    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);
    const decodedRawPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override Event ActorBeginOverlap.raw.png",
    );
    const decodedManifestPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override Event ActorBeginOverlap.shot.json",
    );

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-space-filename",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
    });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath, {
      firstShotButtonName: /override-event-actorbeginoverlap/i,
    });

    const spaceNamedShotButton = page.getByRole("button", {
      name: /override-event-actorbeginoverlap/i,
    });
    await assert.equal(
      await spaceNamedShotButton.getByText("画像未設定").count(),
      0,
      "Space-named existing output images must stay editable instead of showing the unset badge.",
    );
    await page.locator('[data-testid="crop-stage"] img').waitFor();
    await page.getByLabel("画像の説明（Alt テキスト）").fill("空白入りファイル名の画像");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存しました").waitFor();

    await assert.doesNotReject(() => fs.stat(decodedRawPath));
    await assert.doesNotReject(() => fs.stat(decodedManifestPath));
  },
);

test(
  "tutorial shot editor accepts an image pasted from the clipboard",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shot-editor-paste-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const overrideCourse = path.join(tempRoot, "override-course");
    const pastedImageBuffer = await createSolidPngBuffer({ background: "#f97316" });
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    await writeFixtureCourseRepo(overrideCourse, {
      logoText: "Override Tutorial Shot Fixture",
      firstImageName: "override-startup",
      secondImageName: "override-missing-output",
    });

    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-paste",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
    });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath);
    await page.getByText("Ctrl + V").waitFor();
    await page.getByRole("button", { name: /override-missing-output/i }).click();
    await page.getByText("元画像をアップロードしてください。").waitFor();

    await pasteImageIntoEditor(page, toDataUrl(pastedImageBuffer));
    await page.getByText("クリップボードの画像を読み込みました").waitFor();
    await page.locator('[data-testid="crop-stage"] img').waitFor();

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存しました").waitFor();

    const pastedRawPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override-missing-output.raw.png",
    );
    const pastedOutputPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "img",
      "override-missing-output.png",
    );

    await assert.doesNotReject(() => fs.stat(pastedRawPath));
    await assert.doesNotReject(() => fs.stat(pastedOutputPath));
    assert.equal(Buffer.compare(await fs.readFile(pastedRawPath), pastedImageBuffer), 0);
  },
);

test(
  "tutorial shot editor save refreshes the open dev tutorial page to the latest image",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "course-tutorial-shot-editor-live-refresh-"),
    );
    const fixtureCourse = path.join(tempRoot, "course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-live-refresh",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/docs/tutorial/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Tutorial preview page did not become ready.",
      },
    );

    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
    });

    const previewPage = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });
    const editorPage = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await previewPage.goto("/docs/tutorial/", { waitUntil: "domcontentloaded" });
    await getPreviewProbeImage(previewPage).waitFor();

    const initialProbePixel = await readPreviewProbePixel(previewPage, { x: 129, y: 74 });
    assert.deepEqual(
      initialProbePixel,
      [203, 213, 225, 255],
      "The box border position should start from the original tutorial image color.",
    );

    await editorPage.goto("/dev/tutorial-shots/", { waitUntil: "domcontentloaded" });
    await editorPage.getByRole("heading", { name: "チュートリアル画像エディタ" }).waitFor();
    await editorPage.getByRole("button", { name: /startup/i }).waitFor({ timeout: 60_000 });
    await editorPage.getByRole("heading", { name: "必要なら注釈を追加" }).scrollIntoViewIfNeeded();
    await waitForAnnotationCanvasReady(editorPage);

    await editorPage.getByRole("button", { name: "枠を追加" }).click();
    await editorPage.getByRole("button", { name: "矢印を追加" }).click();
    await editorPage.getByRole("button", { name: "保存", exact: true }).click();
    await editorPage.getByText("保存しました").waitFor();

    await waitFor(
      async () => {
        const pixel = await readPreviewProbePixel(previewPage, { x: 129, y: 74 });
        return isTutorialShotHighlightPixel(pixel);
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage: "The open tutorial preview page did not refresh to the saved annotation image.",
      },
    );
  },
);

test(
  "tutorial shot editor canvas keeps PowerPoint-like resize and callout drag behavior wired in",
  async () => {
    const canvasSourcePath = path.join(
      projectRoot,
      "src",
      "app",
      "dev",
      "tutorial-shots",
      "tutorial-shot-editor-canvas.tsx",
    );
    const source = await fs.readFile(canvasSourcePath, "utf8");

    assert.match(
      source,
      /enabledAnchors=\{\[\s*"top-left",\s*"top-center",\s*"top-right",\s*"middle-left",\s*"middle-right",\s*"bottom-left",\s*"bottom-center",\s*"bottom-right",\s*\]\}/s,
    );
    assert.match(source, /keepRatio=\{false\}/);
    assert.match(source, /targetClassName === "Image"/);
    assert.match(source, /targetClassName === "Layer"/);
    assert.match(source, /onMouseDown=\{\(event\) => \{[\s\S]*onSelect\(null\);/);
    assert.match(source, /<Group[\s\S]*draggable[\s\S]*onDragStart=\{\(\) => onSelect\(annotation\.id\)\}/);
    assert.match(
      source,
      /<Arrow[\s\S]*draggable[\s\S]*onDragEnd=\{\(event\) => \{[\s\S]*fromX: current\.fromX \+ offsetX,[\s\S]*toY: current\.toY \+ offsetY,/,
    );
    assert.match(
      source,
      /<Arrow[\s\S]*onDragMove=\{\(event\) => \{[\s\S]*updateArrowDragOffset\(annotation\.id, event\.target\.x\(\), event\.target\.y\(\)\);/,
    );
    assert.match(source, /<Circle[\s\S]*x=\{0\}[\s\S]*y=\{0\}/);
    assert.match(source, /<Text[\s\S]*x=\{-CALLOUT_BADGE_RADIUS\}[\s\S]*y=\{-9\}/);
  },
);

test(
  "tutorial shot editor clears selection on empty canvas clicks",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shot-editor-gui-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const overrideCourse = path.join(tempRoot, "override-course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    await writeFixtureCourseRepo(overrideCourse, {
      logoText: "Override Tutorial Shot Fixture",
      firstImageName: "override-startup",
      secondImageName: "override-missing-output",
    });

    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-gui",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
    });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath);
    await page.getByRole("button", { name: "枠を追加" }).click();
    await page.locator('li[data-selected="true"]').first().waitFor();

    const stageLocator = page.locator('[data-testid="annotation-stage"]');
    const canvasBox = await getAnnotationCanvasBox(page);

    await stageLocator.click({
      position: { x: 620, y: 340 },
    });
    await assert.equal(
      await page.locator('li[data-selected="true"]').count(),
      0,
      "Clicking empty canvas space should clear the selection.",
    );
  },
);

test(
  "tutorial shot editor shows a wider canvas when saved annotations overflow the image",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "course-tutorial-shot-editor-overflow-"),
    );
    const fixtureCourse = path.join(tempRoot, "course");
    const overrideCourse = path.join(tempRoot, "override-course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    await writeFixtureCourseRepo(overrideCourse, {
      logoText: "Override Tutorial Shot Fixture",
      firstImageName: "override-startup",
      secondImageName: "override-missing-output",
    });
    const outputImagePath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "img",
      "override-startup.png",
    );
    const rawImagePath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override-startup.raw.png",
    );
    const manifestPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override-startup.shot.json",
    );
    await fs.mkdir(path.dirname(rawImagePath), { recursive: true });
    await fs.copyFile(outputImagePath, rawImagePath);
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          alt: "override startup",
          annotationMode: "focal",
          annotations: [
            {
              id: "box-left-overflow",
              type: "box",
              role: "action",
              x: -40,
              y: 24,
              width: 120,
              height: 64,
            },
          ],
          crop: {
            x: 0,
            y: 0,
            width: 640,
            height: 360,
          },
          id: "override-startup",
          outputImagePath: "content/docs/tutorial/img/override-startup.png",
          pagePath: "content/docs/tutorial/index.mdx",
          rawImagePath: "content/docs/tutorial/shots/override-startup.raw.png",
          version: 1,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-overflow",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTree(dev);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
    });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath);
    const canvasBox = await getAnnotationCanvasBox(page);
    assert.ok(
      canvasBox.width > 640 + annotationWorkspacePadding * 2,
      "Overflow annotations should expand the editor canvas beyond the image-plus-workspace width.",
    );
    await page.getByText("枠 1/1 ・ 矢印 0/1").waitFor();
  },
);

test(
  "tutorial shot editor API sees COURSE_CONTENT_SOURCE from .env.course.local",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shot-editor-env-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const fixtureCourseEnvPath = fixtureCourse.replaceAll("\\", "/");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const envCourseLocalBackup = await backupFile(envCourseLocalPath);

    await writeFixtureCourseRepo(fixtureCourse);
    await fs.writeFile(
      envCourseLocalPath,
      `COURSE_CONTENT_SOURCE=${fixtureCourseEnvPath}\n`,
      "utf8",
    );

    const childEnv = createRunDevTestEnv({
      label: "tutorial-shot-editor-env-file",
      env: process.env,
    });
    delete childEnv.COURSE_CONTENT_SOURCE;

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      cwd: projectRoot,
      env: childEnv,
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTree(dev);
      await restoreFile(envCourseLocalPath, envCourseLocalBackup);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Tutorial shot editor did not become ready from env file startup.",
      },
    );

    const response = await fetch(`${baseUrl}/api/dev/tutorial-shots/`, {
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.enabled, true);
    assert.equal(data.configuredSource, fixtureCourseEnvPath);
    assert.equal(data.activeSourcePath, fixtureCourseEnvPath);
    assert.ok(Array.isArray(data.shots));
    assert.ok(data.shots.length > 0);
  },
);

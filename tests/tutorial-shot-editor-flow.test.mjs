import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  TUTORIAL_SHOT_EDITOR_WORKSPACE_PADDING,
  TUTORIAL_SHOT_SOURCE_IMAGE_ACCEPT,
} from "../src/lib/tutorial-shots-shared.mjs";
import {
  closeBrowserBounded,
  cleanupWorktreeDevProcesses,
  createRunDevTestEnv,
  killProcessTreeAndWaitForPort,
  waitForProcessExit,
} from "./test-harness-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

before(async () => {
  await cleanupWorktreeDevProcesses({ projectRoot });
});

after(async () => {
  await cleanupWorktreeDevProcesses({ projectRoot });
});

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
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
      throw new Error(
        typeof onTimeoutMessage === "function" ? onTimeoutMessage() : (onTimeoutMessage ?? "Timed out"),
      );
    }
    const result = await fn();
    if (result) {
      return;
    }
    await sleep(intervalMs);
  }
};

const tryFetchStatus = async (url, { timeoutMs = 10_000 } = {}) => {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    return response.status;
  } catch {
    return null;
  }
};

const tryFetchTutorialShotsApi = async (baseUrl) => {
  try {
    const response = await fetch(`${baseUrl}/api/dev/tutorial-shots/`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // Preserve the raw body for timeout diagnostics.
    }
    return {
      status: response.status,
      data,
      text,
    };
  } catch {
    return null;
  }
};

const waitForTutorialShotsApiReady = async (
  baseUrl,
  {
    expectedSourcePath = null,
    expectedShotId = null,
    expectedOutputImagePath = null,
    onTimeoutMessage,
  },
) => {
  let lastResult = null;
  await waitFor(
    async () => {
      lastResult = await tryFetchTutorialShotsApi(baseUrl);
      if (lastResult?.status !== 200 || lastResult.data?.enabled !== true) {
        return false;
      }
      if (expectedSourcePath && lastResult.data.activeSourcePath !== expectedSourcePath) {
        return false;
      }
      if (expectedShotId) {
        if (!Array.isArray(lastResult.data.shots)) {
          return false;
        }
        const expectedShot = lastResult.data.shots.find((shot) => shot?.id === expectedShotId);
        if (!expectedShot) {
          return false;
        }
        if (expectedOutputImagePath) {
          return (
            expectedShot.outputImagePath === expectedOutputImagePath &&
            expectedShot.hasOutputImage === true &&
            expectedShot.bootstrapImagePath === expectedOutputImagePath
          );
        }
        return true;
      }
      return Array.isArray(lastResult.data.shots) && lastResult.data.shots.length > 0;
    },
    {
      timeoutMs: 120_000,
      intervalMs: 1000,
      onTimeoutMessage: () => {
        const status = lastResult?.status ?? "no response";
        const body = (lastResult?.text ?? JSON.stringify(lastResult?.data ?? null)).slice(0, 500);
        return `${onTimeoutMessage} Last API status: ${status}. Last API body: ${body}`;
      },
    },
  );
  return lastResult;
};

const isImageLoaded = async (imageLocator, expectedFilename) => {
  try {
    return await imageLocator.evaluate(
      (image, filename) =>
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0 &&
        (!filename || decodeURIComponent(image.currentSrc || image.src).includes(filename)),
      expectedFilename,
    );
  } catch {
    return false;
  }
};

const waitForReadableFile = async (targetPath, onTimeoutMessage) => {
  await waitFor(
    async () => {
      try {
        const stat = await fs.stat(targetPath);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 60_000,
      intervalMs: 250,
      onTimeoutMessage,
    },
  );
};

const writeFixtureCourseRepo = async (
  rootDir,
  {
    logoText = "Tutorial Shot Fixture",
    firstImageName = "startup",
    secondImageName = "missing-output",
    firstActionImageSrc = `./img/${firstImageName}.webp`,
    secondActionImageSrc = `./img/${secondImageName}.webp`,
    firstImageFileName = `${firstImageName}.webp`,
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

  const fixtureImage = sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: "#cbd5e1",
    },
  });
  const firstImagePath = path.join(imageDir, firstImageFileName);
  if (path.extname(firstImageFileName).toLowerCase() === ".webp") {
    await fixtureImage.webp({ lossless: true }).toFile(firstImagePath);
  } else {
    await fixtureImage.png().toFile(firstImagePath);
  }
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

const createSolidWebpBuffer = async ({ background = "#22c55e", width = 320, height = 180 } = {}) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .webp({ lossless: true })
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

const dragImageOverEditor = async (page, imageDataUrl) => {
  await page.evaluate(async (dataUrl) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], "drag-preview.png", { type: blob.type || "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const dropZone = document.querySelector('[data-testid="source-image-drop-zone"]');
    if (!dropZone) {
      throw new Error("Source image drop zone was not found.");
    }

    dropZone.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }),
    );
  }, imageDataUrl);
};

const dropImageIntoEditor = async (page, imageDataUrl, fileName = "dropped.png") => {
  await page.evaluate(
    async ({ dataUrl, fileName: droppedFileName }) => {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], droppedFileName, { type: blob.type || "image/png" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const dropZone = document.querySelector('[data-testid="source-image-drop-zone"]');
      if (!dropZone) {
        throw new Error("Source image drop zone was not found.");
      }

      dropZone.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
      );
    },
    { dataUrl: imageDataUrl, fileName },
  );
};

const getPreviewProbeImage = (page) => page.locator('img[alt="保存反映確認"]:visible').first();

const readAnnotationListSummary = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("li[data-selected]")).map((item) => ({
      selected: item.getAttribute("data-selected"),
      label: item.querySelector("button")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    })),
  );

const isTutorialShotHighlightPixel = (pixel) =>
  Array.isArray(pixel) &&
  pixel.length === 4 &&
  pixel[0] >= 250 &&
  pixel[1] >= 100 &&
  pixel[1] <= 110 &&
  pixel[2] <= 10 &&
  pixel[3] === 255;

// Matches either an orange Action-box stroke or a near-white Verify-box stroke.
const isAnnotationStrokePixel = (pixel) =>
  isTutorialShotHighlightPixel(pixel) ||
  (Array.isArray(pixel) &&
    pixel.length === 4 &&
    pixel[0] >= 245 &&
    pixel[1] >= 245 &&
    pixel[2] >= 245 &&
    pixel[3] === 255);

const readPreviewProbePixel = async (page, { x = 8, y = 8 } = {}) =>
  getPreviewProbeImage(page).evaluate(
    (image, coordinates) => {
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
    },
    { x, y },
  );

const previewProbeHasHighlightPixel = async (page) =>
  getPreviewProbeImage(page).evaluate((image) => {
    if (!(image instanceof HTMLImageElement) || !image.complete || image.naturalWidth === 0) {
      return false;
    }

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return false;
    }

    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] >= 250 &&
        pixels[index + 1] >= 100 &&
        pixels[index + 1] <= 110 &&
        pixels[index + 2] <= 10 &&
        pixels[index + 3] === 255
      ) {
        return true;
      }
    }
    return false;
  });

const evaluateExactTutorialImage = async (
  page,
  descriptor,
  { pixelCoordinates = null, scanForAnnotationStroke = false } = {},
) =>
  page.locator("img").evaluateAll(
    (images, { descriptor: expectedImage, pixelCoordinates, scanForAnnotationStroke }) => {
      const findMatchingImage = () =>
        images.find((image) => {
          if (!(image instanceof HTMLImageElement)) {
            return false;
          }
          if (expectedImage.alt && image.getAttribute("alt") !== expectedImage.alt) {
            return false;
          }

          let url;
          try {
            url = new URL(
              image.currentSrc || image.src || image.getAttribute("src") || "",
              document.baseURI,
            );
          } catch {
            return false;
          }

          if (url.pathname !== expectedImage.apiPath) {
            return false;
          }
          if (url.searchParams.get("path") !== expectedImage.imagePath) {
            return false;
          }
          return Object.entries(expectedImage.searchParams ?? {}).every(
            ([key, value]) => url.searchParams.get(key) === value,
          );
        });

      const image = findMatchingImage();
      if (!image) {
        return {
          found: false,
          loaded: false,
          sources: images.map((candidate) => candidate.getAttribute("src") ?? candidate.currentSrc),
        };
      }

      const rect = image.getBoundingClientRect();
      const loaded =
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0 &&
        rect.width > 0 &&
        rect.height > 0;
      if (!loaded) {
        return {
          found: true,
          loaded: false,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          rect: { width: rect.width, height: rect.height },
          src: image.getAttribute("src") ?? image.currentSrc,
        };
      }
      if (!pixelCoordinates && !scanForAnnotationStroke) {
        return { found: true, loaded: true, src: image.getAttribute("src") ?? image.currentSrc };
      }

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        return { found: true, loaded: true, src: image.getAttribute("src") ?? image.currentSrc };
      }
      context.drawImage(image, 0, 0);

      if (pixelCoordinates) {
        return {
          found: true,
          loaded: true,
          pixel: Array.from(
            context.getImageData(pixelCoordinates.x, pixelCoordinates.y, 1, 1).data,
          ),
          src: image.getAttribute("src") ?? image.currentSrc,
        };
      }

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        const isActionStroke =
          pixels[index] >= 250 &&
          pixels[index + 1] >= 100 &&
          pixels[index + 1] <= 110 &&
          pixels[index + 2] <= 10 &&
          pixels[index + 3] === 255;
        const isVerifyStroke =
          pixels[index] >= 245 &&
          pixels[index + 1] >= 245 &&
          pixels[index + 2] >= 245 &&
          pixels[index + 3] === 255;
        if (isActionStroke || isVerifyStroke) {
          return {
            found: true,
            loaded: true,
            hasAnnotationStrokePixel: true,
            src: image.getAttribute("src") ?? image.currentSrc,
          };
        }
      }
      return {
        found: true,
        loaded: true,
        hasAnnotationStrokePixel: false,
        src: image.getAttribute("src") ?? image.currentSrc,
      };
    },
    { descriptor, pixelCoordinates, scanForAnnotationStroke },
  );

const syncContentForDevTest = async (env) => {
  const sync = spawn(process.execPath, ["scripts/sync-course-content.mjs"], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  await waitForProcessExit(sync, "sync-course-content");
};

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
      "override-startup.webp",
    );
    const startupOutputHashBefore = await sha256File(startupOutputPath);
    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      detached: process.platform !== "win32",
      windowsHide: true,
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
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });
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
      "override-startup.raw.webp",
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
      detached: process.platform !== "win32",
      windowsHide: true,
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
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });
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
    await getAnnotationCanvas(page).waitFor({ timeout: 30_000 });
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
      detached: process.platform !== "win32",
      windowsHide: true,
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
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath);
    assert.equal(
      await page.locator('input[type="file"]').getAttribute("accept"),
      TUTORIAL_SHOT_SOURCE_IMAGE_ACCEPT,
    );
    await page.getByText("ドロップ、ボタン、").waitFor();
    await page.getByText("Ctrl + V").first().waitFor();
    await page.getByRole("button", { name: /override-missing-output/i }).click();
    await page.getByText("元画像をアップロードしてください。").waitFor();
    await page.getByText("元画像はここへドラッグ＆ドロップできます。ボタンで選ぶか、").waitFor();

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
      "override-missing-output.webp",
    );

    await assert.doesNotReject(() => fs.stat(pastedRawPath));
    await assert.doesNotReject(() => fs.stat(pastedOutputPath));
    const pastedRawMetadata = await sharp(pastedRawPath).metadata();
    assert.equal(pastedRawMetadata.width, 640);
    assert.equal(pastedRawMetadata.height, 360);
  },
);

test("tutorial shot editor imports a dropped source image", { timeout: 3 * 60_000 }, async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shot-editor-drop-"));
  const fixtureCourse = path.join(tempRoot, "course");
  const overrideCourse = path.join(tempRoot, "override-course");
  const droppedImageBuffer = await createSolidPngBuffer({ background: "#22c55e" });
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
    detached: process.platform !== "win32",
    windowsHide: true,
    cwd: projectRoot,
    env: createRunDevTestEnv({
      label: "tutorial-shot-editor-drop",
      env: process.env,
      overrides: {
        COURSE_CONTENT_SOURCE: fixtureCourse,
      },
    }),
    stdio: "inherit",
  });

  t.after(async () => {
    await killProcessTreeAndWaitForPort(dev, port);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await waitFor(
    async () => {
      const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
      return status === 200 || status === 308;
    },
    {
      timeoutMs: 120_000,
      intervalMs: 1000,
      onTimeoutMessage: "Tutorial shot editor did not become ready.",
    },
  );

  let browser;
  t.after(async () => {
    await closeBrowserBounded(browser);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    baseURL: baseUrl,
    viewport: { width: 1440, height: 1100 },
  });

  await openTutorialShotEditor(page, overrideCourseRelativePath);
  await page.getByRole("button", { name: /override-missing-output/i }).click();
  await page.getByText("元画像をアップロードしてください。").waitFor();

  await dragImageOverEditor(page, toDataUrl(droppedImageBuffer));
  await page.getByText("ここに画像をドロップして読み込みます").waitFor();

  await dropImageIntoEditor(page, toDataUrl(droppedImageBuffer));
  await page.getByText("ドロップした画像を読み込みました（dropped.png）").waitFor();
  await page.locator('[data-testid="crop-stage"] img').waitFor();

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("保存しました").waitFor();

  const droppedRawPath = path.join(
    overrideCourse,
    "content",
    "docs",
    "tutorial",
    "shots",
    "override-missing-output.raw.png",
  );
  const droppedOutputPath = path.join(
    overrideCourse,
    "content",
    "docs",
    "tutorial",
    "img",
    "override-missing-output.webp",
  );

  await assert.doesNotReject(() => fs.stat(droppedRawPath));
  await assert.doesNotReject(() => fs.stat(droppedOutputPath));
  const droppedRawMetadata = await sharp(droppedRawPath).metadata();
  assert.equal(droppedRawMetadata.width, 640);
  assert.equal(droppedRawMetadata.height, 360);
});

test(
  "tutorial shot editor preserves a dropped WebP source image and generates WebP output",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "course-tutorial-shot-editor-webp-drop-"),
    );
    const fixtureCourse = path.join(tempRoot, "course");
    const overrideCourse = path.join(tempRoot, "override-course");
    const droppedImageBuffer = await createSolidWebpBuffer();
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    await writeFixtureCourseRepo(overrideCourse, {
      logoText: "Override Tutorial Shot Fixture",
      firstImageName: "override-startup",
      secondImageName: "override-missing-output",
      secondActionImageSrc: "./img/override-missing-output.webp",
    });

    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      detached: process.platform !== "win32",
      windowsHide: true,
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-webp-drop",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath);
    await page.getByRole("button", { name: /override-missing-output/i }).click();
    await page.getByText("元画像をアップロードしてください。").waitFor();

    await dropImageIntoEditor(page, toDataUrl(droppedImageBuffer, "image/webp"), "dropped.webp");
    await page.getByText("ドロップした画像を読み込みました（dropped.webp）").waitFor();
    await page.locator('[data-testid="crop-stage"] img').waitFor();

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("保存しました").waitFor();

    const droppedRawPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override-missing-output.raw.webp",
    );
    const droppedOutputPath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "img",
      "override-missing-output.webp",
    );
    const droppedRawBytes = await fs.readFile(droppedRawPath);
    const droppedRawHash = crypto.createHash("sha256").update(droppedRawBytes).digest("hex");
    const droppedSourceHash = crypto.createHash("sha256").update(droppedImageBuffer).digest("hex");
    assert.equal(droppedRawHash, droppedSourceHash);
    const droppedRawMetadata = await sharp(droppedRawBytes).metadata();
    assert.equal(droppedRawMetadata.format, "webp");
    assert.equal(droppedRawMetadata.width, 320);
    assert.equal(droppedRawMetadata.height, 180);

    const droppedOutputBytes = await fs.readFile(droppedOutputPath);
    const droppedOutputMetadata = await sharp(droppedOutputBytes).metadata();
    assert.equal(droppedOutputMetadata.format, "webp");
    assert.equal(droppedOutputMetadata.width, 320);
    assert.equal(droppedOutputMetadata.height, 180);
  },
);

test(
  "tutorial shot editor save refreshes the open dev tutorial page to the latest image",
  { timeout: 5 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "course-tutorial-shot-editor-live-refresh-"),
    );
    const fixtureCourse = path.join(tempRoot, "course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const liveRefreshImageName = `startup-live-refresh-${crypto.randomUUID()}`;
    const liveRefreshImageFileName = `${liveRefreshImageName}.webp`;
    const liveRefreshOutputImagePath = `content/docs/tutorial/img/${liveRefreshImageName}.webp`;

    await writeFixtureCourseRepo(fixtureCourse, { firstImageName: liveRefreshImageName });

    const devEnv = createRunDevTestEnv({
      label: "tutorial-shot-editor-live-refresh",
      env: process.env,
      overrides: {
        COURSE_CONTENT_SOURCE: fixtureCourse,
      },
    });
    await syncContentForDevTest(devEnv);
    await assert.doesNotReject(() =>
      fs.stat(
        path.join(projectRoot, "content", "docs", "tutorial", "img", `${liveRefreshImageName}.webp`),
      ),
    );

    const dev = spawn(
      process.execPath,
      [path.join(projectRoot, "scripts", "run-dev.mjs"), "--port", String(port)],
      {
      detached: process.platform !== "win32",
      windowsHide: true,
      cwd: projectRoot,
      env: devEnv,
      stdio: "inherit",
      },
    );

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/docs/tutorial/`, { timeoutMs: 60_000 });
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 180_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial preview page did not become ready.",
      },
    );

    await waitFor(
      async () => {
        const status = await tryFetchStatus(
          `${baseUrl}/docs/tutorial/img/${liveRefreshImageFileName}`,
        );
        return status === 200;
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage: "Tutorial preview probe source image did not become available.",
      },
    );

    await waitForTutorialShotsApiReady(baseUrl, {
      expectedSourcePath: fixtureCourse,
      expectedShotId: liveRefreshImageName,
      expectedOutputImagePath: liveRefreshOutputImagePath,
      onTimeoutMessage: "Tutorial shot editor API did not expose the exact live-refresh fixture image.",
    });

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });

    const previewPage = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });
    const editorPage = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await waitFor(
      async () => {
        try {
          await previewPage.goto("/docs/tutorial/", { waitUntil: "domcontentloaded" });
          await getPreviewProbeImage(previewPage).waitFor({ timeout: 5_000 });
          return await isImageLoaded(getPreviewProbeImage(previewPage), liveRefreshImageFileName);
        } catch {
          return false;
        }
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial preview probe image did not become visible.",
      },
    );

    const originalProbePixel = [203, 213, 225, 255];
    let initialProbePixel = null;
    await waitFor(
      async () => {
        if (!(await isImageLoaded(getPreviewProbeImage(previewPage), liveRefreshImageFileName))) {
          return false;
        }
        initialProbePixel = await readPreviewProbePixel(previewPage, { x: 200, y: 72 });
        return initialProbePixel?.every((value, index) => value === originalProbePixel[index]);
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage:
          "The box border position should start from the original tutorial image color.",
      },
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
    await editorPage.close();

    await waitFor(
      async () => {
        try {
          return await previewProbeHasHighlightPixel(previewPage);
        } catch {
          return false;
        }
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage:
          "The open tutorial preview page did not refresh to the saved annotation image.",
      },
    );
  },
);

test(
  "tutorial shot editor save refreshes the open dev tutorial page after saving a Verify image",
  { timeout: 5 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "course-tutorial-shot-editor-verify-reload-"),
    );
    const fixtureCourse = path.join(tempRoot, "course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    // Write a fixture that includes a <Verify img="..."> on the tutorial page
    // plus an imported image element that probes the exact generated fixture file.
    const verifyImageName = `startup-result-${crypto.randomUUID()}`;
    const verifyImageFileName = `${verifyImageName}.webp`;
    const verifyOutputImagePath = `content/docs/tutorial/img/${verifyImageFileName}`;
    const verifyProbeImageUrl = `/api/dev/tutorial-shots/image/?path=${encodeURIComponent(verifyOutputImagePath)}&v=fixture`;
    const verifyProbeImageMdxSrc = `/api/dev/tutorial-shots/image/?path=${encodeURIComponent(verifyOutputImagePath)}&amp;v=fixture`;
    const siteConfig = `export const siteConfig = {
  logoText: "Verify Reload Fixture",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "verify reload fixture",
  faviconHref: "/img/favicon.ico",
} as const;
`;
    const rootMeta = `const meta = {
  "*": { type: "page", theme: { timestamp: false } },
  index: { display: "hidden" },
  docs: "Docs",
};
export default meta;
`;
    const docsMeta = `const meta = { tutorial: {} };
export default meta;
`;
    const tutorialPage = `---
title: Tutorial
---

<Section title="Step 1" goal="Verify 画像を保存できる状態">
  <Action img="./img/startup.webp">
    **起動** を確認します
  </Action>
  <Verify img="./img/${verifyImageFileName}">
    画面がこの状態になれば成功
  </Verify>
</Section>

<img alt="Verify保存反映確認" src="${verifyProbeImageMdxSrc}" />
`;

    const courseDir = fixtureCourse;
    const pageDir = path.join(courseDir, "content", "docs", "tutorial");
    const imageDir = path.join(pageDir, "img");
    const verifySourceImagePath = path.join(imageDir, verifyImageFileName);
    const syncedVerifyImagePath = path.join(
      projectRoot,
      "content",
      "docs",
      "tutorial",
      "img",
      verifyImageFileName,
    );
    await fs.mkdir(imageDir, { recursive: true });
    await fs.mkdir(path.join(courseDir, "public", "img"), { recursive: true });
    await fs.writeFile(path.join(courseDir, "site.config.ts"), siteConfig, "utf8");
    await fs.writeFile(path.join(courseDir, "content", "_meta.ts"), rootMeta, "utf8");
    await fs.writeFile(path.join(courseDir, "content", "docs", "_meta.ts"), docsMeta, "utf8");
    await fs.writeFile(path.join(pageDir, "index.mdx"), tutorialPage, "utf8");
    await fs.writeFile(path.join(courseDir, "public", "img", "favicon.ico"), "", "utf8");

    // Action image (startup.webp) — needs to exist so the Action shot can be
    // bootstrapped from output when there is no raw image yet.
    await sharp({
      create: { width: 640, height: 360, channels: 4, background: "#cbd5e1" },
    })
      .webp({ lossless: true })
      .toFile(path.join(imageDir, "startup.webp"));

    // Verify image — initial solid blue; after save it will have an orange box.
    await sharp({
      create: { width: 640, height: 360, channels: 4, background: "#cbd5e1" },
    })
      .webp({ lossless: true })
      .toFile(verifySourceImagePath);
    const verifyImageHashBefore = await sha256File(verifySourceImagePath);

    const devEnv = createRunDevTestEnv({
      label: "tutorial-shot-editor-verify-reload",
      env: process.env,
      overrides: {
        COURSE_CONTENT_SOURCE: fixtureCourse,
      },
    });
    await cleanupWorktreeDevProcesses({ projectRoot });
    await syncContentForDevTest(devEnv);
    assert.match(
      await fs.readFile(path.join(projectRoot, "content", "docs", "tutorial", "index.mdx"), "utf8"),
      new RegExp(verifyImageName),
    );
    await assert.doesNotReject(() => fs.stat(syncedVerifyImagePath));
    assert.equal(await sha256File(syncedVerifyImagePath), verifyImageHashBefore);
    await waitForReadableFile(
      path.join(projectRoot, ...verifyOutputImagePath.split("/")),
      "Verify probe fixture image was not synced into the app content tree.",
    );

    const dev = spawn(
      process.execPath,
      [path.join(projectRoot, "scripts", "run-dev.mjs"), "--port", String(port)],
      {
        detached: process.platform !== "win32",
        windowsHide: true,
        cwd: projectRoot,
        env: devEnv,
        stdio: "inherit",
      },
    );

    t.after(async () => {
      try {
        await killProcessTreeAndWaitForPort(dev, port);
      } finally {
        try {
          await cleanupWorktreeDevProcesses({ projectRoot });
        } finally {
          await fs.rm(tempRoot, { recursive: true, force: true });
        }
      }
    });

    await waitForTutorialShotsApiReady(baseUrl, {
      expectedSourcePath: fixtureCourse,
      expectedShotId: verifyImageName,
      expectedOutputImagePath: verifyOutputImagePath,
      onTimeoutMessage: "Tutorial shot editor API did not expose the exact Verify fixture image.",
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}${verifyProbeImageUrl}`);
        return status === 200;
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage: "Verify probe image API did not expose the exact fixture image.",
      },
    );

    let browser;
    let previewPage;
    let editorPage;
    const openBrowserPages = async () => {
      await closeBrowserBounded(browser);
      browser = await chromium.launch({ headless: true });
      previewPage = await browser.newPage({
        baseURL: baseUrl,
        viewport: { width: 1440, height: 1100 },
      });
      editorPage = await browser.newPage({
        baseURL: baseUrl,
        viewport: { width: 1440, height: 1100 },
      });
    };
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    await openBrowserPages();

    const verifyProbeImageDescriptor = {
      alt: "Verify保存反映確認",
      apiPath: "/api/dev/tutorial-shots/image/",
      imagePath: verifyOutputImagePath,
      searchParams: { v: "fixture" },
    };
    let lastVerifyProbeImageState = null;
    let previewPageHasExactProbeImage = false;
    await waitFor(
      async () => {
        try {
          if (!previewPageHasExactProbeImage) {
            await previewPage.goto("/docs/tutorial/", { waitUntil: "domcontentloaded" });
          }
          lastVerifyProbeImageState = await evaluateExactTutorialImage(
            previewPage,
            verifyProbeImageDescriptor,
          );
          previewPageHasExactProbeImage = lastVerifyProbeImageState.found === true;
          return lastVerifyProbeImageState.loaded === true;
        } catch (error) {
          const navigationError = error instanceof Error ? error.message : String(error);
          lastVerifyProbeImageState = {
            found: false,
            loaded: false,
            navigationError,
          };
          previewPageHasExactProbeImage = false;
          if (/Target page, context or browser has been closed/u.test(navigationError)) {
            await openBrowserPages();
          }
          return false;
        }
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: () =>
          `Verify probe image did not become visible on the tutorial page. Last image state: ${JSON.stringify(lastVerifyProbeImageState).slice(0, 500)}`,
      },
    );

    const readVerifyProbePixel = async (x = 8, y = 8) =>
      (
        await evaluateExactTutorialImage(previewPage, verifyProbeImageDescriptor, {
          pixelCoordinates: { x, y },
        })
      ).pixel ?? null;

    const originalProbePixel = [203, 213, 225, 255];
    let initialPixel = null;
    await waitFor(
      async () => {
        initialPixel = await readVerifyProbePixel(200, 72);
        return initialPixel?.every((value, index) => value === originalProbePixel[index]);
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage:
          "Verify probe pixel should start from the original (un-annotated) image color.",
      },
    );

    await waitForTutorialShotsApiReady(
      baseUrl,
      {
        expectedSourcePath: fixtureCourse,
        expectedShotId: verifyImageName,
        expectedOutputImagePath: verifyOutputImagePath,
        onTimeoutMessage: "Tutorial shot editor API did not stay ready for Verify image save.",
      },
    );

    await editorPage.goto("/dev/tutorial-shots/", { waitUntil: "domcontentloaded" });
    await editorPage.getByRole("heading", { name: "チュートリアル画像エディタ" }).waitFor();

    // Select the Verify shot (startup-result) in the sidebar.
    await editorPage
      .getByRole("button", { name: new RegExp(verifyImageName, "i") })
      .waitFor({ timeout: 60_000 });
    await editorPage.getByRole("button", { name: new RegExp(verifyImageName, "i") }).click();

    await editorPage.getByRole("heading", { name: "必要なら注釈を追加" }).scrollIntoViewIfNeeded();
    await waitForAnnotationCanvasReady(editorPage);

    // Add a box annotation and save.
    await editorPage.getByRole("button", { name: "枠を追加" }).click();
    await editorPage.getByRole("button", { name: "保存", exact: true }).click();
    await editorPage.getByText("保存しました").waitFor();

    await waitFor(
      async () => {
        try {
          return (
            (await sha256File(verifySourceImagePath)) !== verifyImageHashBefore &&
            (await sha256File(syncedVerifyImagePath)) !== verifyImageHashBefore
          );
        } catch {
          return false;
        }
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage: "Saved Verify image did not reach both source and synced content files.",
      },
    );
    await editorPage.close();

    // The docs page should reload automatically via the SSE revision bump,
    // showing the newly annotated Verify image (white dashed box = annotation stroke pixel).
    await waitFor(
      async () => {
        try {
          return (
            await evaluateExactTutorialImage(previewPage, verifyProbeImageDescriptor, {
              scanForAnnotationStroke: true,
            })
          ).hasAnnotationStrokePixel === true;
        } catch {
          return false;
        }
      },
      {
        timeoutMs: 30_000,
        intervalMs: 250,
        onTimeoutMessage:
          "The open tutorial preview page did not refresh after saving a Verify image.",
      },
    );
  },
);

test("tutorial shot editor canvas keeps PowerPoint-like resize and callout drag behavior wired in", async () => {
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
  assert.match(
    source,
    /<Group[\s\S]*draggable[\s\S]*onDragStart=\{\(\) => onSelect\(annotation\.id\)\}/,
  );
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
});

test("dev auto reload does not reload the tutorial shot editor itself", async () => {
  const autoReloadSourcePath = path.join(projectRoot, "src", "components", "dev-auto-reload.tsx");
  const source = await fs.readFile(autoReloadSourcePath, "utf8");

  assert.match(source, /window\.location\.pathname\.startsWith\('\/dev\/'\)/);
  assert.match(source, /return undefined;/);
});

test(
  "tutorial shot editor reorders callout numbers from the sidebar list",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "course-tutorial-shot-editor-callout-reorder-"),
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

    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      detached: process.platform !== "win32",
      windowsHide: true,
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "tutorial-shot-editor-callout-reorder",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1100 },
    });

    await openTutorialShotEditor(page, overrideCourseRelativePath);
    await page.getByRole("button", { name: "番号コールアウト" }).click();
    await page.getByRole("button", { name: "枠を追加" }).click();
    await page.getByRole("button", { name: "枠を追加" }).click();
    await page.getByRole("button", { name: "枠を追加" }).click();

    const annotationItems = page.locator("li[data-selected]");
    await assert.equal(await annotationItems.count(), 3);

    await annotationItems.nth(1).locator("button").first().click();
    await waitFor(
      async () => {
        const summary = await readAnnotationListSummary(page);
        return summary[1]?.selected === "true";
      },
      {
        timeoutMs: 10_000,
        intervalMs: 100,
        onTimeoutMessage: "The second callout row did not become selected.",
      },
    );

    const before = await readAnnotationListSummary(page);
    assert.match(
      before[1]?.label ?? "",
      /^② 枠 2/,
      "The selected second row should start as callout number 2 before reordering.",
    );

    await annotationItems.nth(1).dragTo(annotationItems.nth(0));

    await waitFor(
      async () => {
        const summary = await readAnnotationListSummary(page);
        return summary[0]?.selected === "true";
      },
      {
        timeoutMs: 10_000,
        intervalMs: 100,
        onTimeoutMessage: "Dragging the second callout row to the top did not reorder the list.",
      },
    );

    const after = await readAnnotationListSummary(page);
    assert.match(
      after[0]?.label ?? "",
      /^① 枠 1/,
      "The dragged callout should become number 1 after moving to the top of the list.",
    );
    assert.equal(
      after[0]?.selected,
      "true",
      "The same selected callout should remain selected after reordering.",
    );
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
      detached: process.platform !== "win32",
      windowsHide: true,
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
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });
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
      "override-startup.webp",
    );
    const rawImagePath = path.join(
      overrideCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "override-startup.raw.webp",
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
          outputImagePath: "content/docs/tutorial/img/override-startup.webp",
          pagePath: "content/docs/tutorial/index.mdx",
          rawImagePath: "content/docs/tutorial/shots/override-startup.raw.webp",
          version: 1,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const overrideCourseRelativePath = path.relative(projectRoot, overrideCourse);

    const devEnv = createRunDevTestEnv({
      label: "tutorial-shot-editor-overflow",
      env: process.env,
      overrides: {
        COURSE_CONTENT_SOURCE: fixtureCourse,
      },
    });
    await syncContentForDevTest(devEnv);

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      detached: process.platform !== "win32",
      windowsHide: true,
      cwd: projectRoot,
      env: devEnv,
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitFor(
      async () => {
        const status = await tryFetchStatus(`${baseUrl}/dev/tutorial-shots/`);
        return status === 200 || status === 308;
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        onTimeoutMessage: "Tutorial shot editor did not become ready.",
      },
    );

    let browser;
    t.after(async () => {
      await closeBrowserBounded(browser);
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      baseURL: baseUrl,
      viewport: { width: 1920, height: 1100 },
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
    const envFileRoot = path.join(tempRoot, "env-files");
    const envCourseLocalPath = path.join(envFileRoot, ".env.course.local");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    await fs.mkdir(envFileRoot, { recursive: true });
    await fs.writeFile(
      envCourseLocalPath,
      `COURSE_CONTENT_SOURCE=${fixtureCourseEnvPath}\n`,
      "utf8",
    );

    const childEnv = createRunDevTestEnv({
      label: "tutorial-shot-editor-env-file",
      env: process.env,
      overrides: {
        COURSE_DOCS_ENV_FILE_DIR: envFileRoot,
      },
    });
    delete childEnv.COURSE_CONTENT_SOURCE;

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      detached: process.platform !== "win32",
      windowsHide: true,
      cwd: projectRoot,
      env: childEnv,
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    const readyResult = await waitForTutorialShotsApiReady(
      baseUrl,
      {
        expectedSourcePath: fixtureCourseEnvPath,
        expectedShotId: "startup",
        onTimeoutMessage: "Tutorial shot editor API did not become ready from env file startup.",
      },
    );

    const { status, data } = readyResult;

    assert.equal(status, 200);
    assert.equal(data.enabled, true);
    assert.equal(data.configuredSource, fixtureCourseEnvPath);
    assert.equal(data.activeSourcePath, fixtureCourseEnvPath);
    assert.ok(Array.isArray(data.shots));
    assert.ok(data.shots.length > 0);
  },
);

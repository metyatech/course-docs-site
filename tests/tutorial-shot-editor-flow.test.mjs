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
import { createRunDevTestEnv } from "./test-harness-env.mjs";

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

const killProcessTree = async (child) => {
  if (!child || child.killed) {
    return;
  }
  try {
    child.kill();
  } catch {
    // ignore
  }

  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }
  await Promise.race([new Promise((resolve) => child.on("exit", () => resolve())), sleep(10_000)]);
};

const writeFixtureCourseRepo = async (
  rootDir,
  {
    logoText = "Tutorial Shot Fixture",
    firstImageName = "startup",
    secondImageName = "missing-output",
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
  <Action img="./img/${firstImageName}.png">
    **${firstImageName}** を確認します
  </Action>
  <Action img="./img/${secondImageName}.png">
    **${secondImageName}** を確認します
  </Action>
</Section>
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
    .toFile(path.join(imageDir, `${firstImageName}.png`));
};

const sha256File = async (filePath) => {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
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
    const page = await browser.newPage({ baseURL: baseUrl });

    await page.goto("/dev/tutorial-shots/", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "チュートリアル画像エディタ" }).waitFor();
    await page.getByRole("button", { name: "別のリポジトリに切り替え" }).click();
    await page.getByPlaceholder("../open-campus-unreal-90min").fill(overrideCourseRelativePath);
    await page.getByRole("button", { name: "切り替える" }).click();
    await page.getByRole("button", { name: /override-startup/i }).waitFor();

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

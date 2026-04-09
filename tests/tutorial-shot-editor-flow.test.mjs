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

const writeFixtureCourseRepo = async (rootDir) => {
  const siteConfig = `export const siteConfig = {
  logoText: "Tutorial Shot Fixture",
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
  <Action img="./img/startup.png">
    **Startup** を確認します
  </Action>
  <Action img="./img/missing-output.png">
    **Missing output** を確認します
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
    .toFile(path.join(imageDir, "startup.png"));
};

const sha256File = async (filePath) => {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
};

test(
  "tutorial shot editor saves bootstrap shots and reports missing-output failures clearly",
  { timeout: 3 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-tutorial-shot-editor-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);

    const startupOutputPath = path.join(
      fixtureCourse,
      "content",
      "docs",
      "tutorial",
      "img",
      "startup.png",
    );
    const startupOutputHashBefore = await sha256File(startupOutputPath);

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
    await page.getByRole("heading", { name: "Tutorial Shot Editor" }).waitFor();

    await page.getByLabel("Alt").fill("起動画面");
    await page.getByRole("button", { name: "Add Label" }).click();
    await page.getByLabel("Label text").fill("Play");
    await page.getByRole("button", { name: "Save Shot" }).click();
    await page.getByText("Saved tutorial shot.").waitFor();

    await page.getByRole("button", { name: /missing-output/i }).click();
    await page.getByText("Upload a raw screenshot to start editing this Action image.").waitFor();
    await page.getByRole("button", { name: "Save Shot" }).click();
    await page
      .getByText(
        "Cannot save this Action image because no raw screenshot is available yet. Upload a raw screenshot first.",
      )
      .waitFor();

    const startupRawPath = path.join(
      fixtureCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "startup.raw.png",
    );
    const startupManifestPath = path.join(
      fixtureCourse,
      "content",
      "docs",
      "tutorial",
      "shots",
      "startup.shot.json",
    );

    await assert.doesNotReject(() => fs.stat(startupRawPath));
    await assert.doesNotReject(() => fs.stat(startupManifestPath));

    const startupManifest = JSON.parse(await fs.readFile(startupManifestPath, "utf8"));
    assert.equal(startupManifest.alt, "起動画面");
    assert.deepEqual(startupManifest.annotations, [
      {
        id: startupManifest.annotations[0].id,
        type: "label",
        x: 24,
        y: 48,
        text: "Play",
      },
    ]);

    const startupOutputHashAfter = await sha256File(startupOutputPath);
    assert.notEqual(startupOutputHashAfter, startupOutputHashBefore);

    const startupRawHash = await sha256File(startupRawPath);
    assert.equal(startupRawHash, startupOutputHashBefore);
  },
);

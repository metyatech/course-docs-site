import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRunDevTestEnv, killProcessTree } from "./test-harness-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBinPath = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");

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

const fetchResponse = async (url, timeoutMs = 60_000) =>
  fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });

const tryFetchText = async (url) => {
  try {
    const response = await fetchResponse(url);
    return { status: response.status, text: await response.text() };
  } catch {
    return null;
  }
};

const decodeHtmlAttribute = (value) => value.replaceAll("&amp;", "&");

const waitForProcessExit = (child, label) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code ?? "null"}`));
    });
  });

const writeFixtureCourseRepo = async (rootDir) => {
  const siteConfig = `export const siteConfig = {
  logoText: "Import Asset Resolution",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "import asset resolution fixture",
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
  imports: {},
};

export default meta;
`;

  const importsMdx = `---
title: Import Assets
---

import archiveUrl from './assets/packet.zip';
import handoutUrl from './assets/handout.pdf';
import demoVideoUrl from './assets/demo.mp4';

<DownloadLink file={archiveUrl} filename="packet.zip" />
<DownloadLink file={handoutUrl} filename="handout.pdf" />

<video controls width="100%">
  <source src={demoVideoUrl} type="video/mp4" />
</video>
`;

  const tinyZip = Buffer.from("504b050600000000000000000000000000000000", "hex");
  const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8");
  const tinyMp4 = Buffer.from(
    "000000206674797069736f6d0000020069736f6d69736f32617663316d703431",
    "hex",
  );

  await fs.mkdir(path.join(rootDir, "content", "docs", "imports", "assets"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "public", "img"), { recursive: true });

  await fs.writeFile(path.join(rootDir, "site.config.ts"), siteConfig, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "_meta.ts"), rootMeta, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "docs", "_meta.ts"), docsMeta, "utf8");
  await fs.writeFile(
    path.join(rootDir, "content", "docs", "imports", "index.mdx"),
    importsMdx,
    "utf8",
  );
  await fs.writeFile(
    path.join(rootDir, "content", "docs", "imports", "assets", "packet.zip"),
    tinyZip,
  );
  await fs.writeFile(
    path.join(rootDir, "content", "docs", "imports", "assets", "handout.pdf"),
    tinyPdf,
  );
  await fs.writeFile(
    path.join(rootDir, "content", "docs", "imports", "assets", "demo.mp4"),
    tinyMp4,
  );
  await fs.writeFile(path.join(rootDir, "public", "img", "favicon.ico"), "", "utf8");
};


test(
  "imported download assets resolve through stable-filename URLs",
  { timeout: 2 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-import-assets-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let server = null;

    t.after(async () => {
      await killProcessTree(server);
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await writeFixtureCourseRepo(fixtureCourse);

    const env = createRunDevTestEnv({
      label: "import-asset-resolution",
      env: process.env,
      overrides: {
        COURSE_CONTENT_SOURCE: fixtureCourse,
        COURSE_DOCS_SKIP_BUILD_LINT: "1",
        COURSE_DOCS_SKIP_BUILD_TYPECHECK: "1",
      },
    });

    const sync = spawn(process.execPath, ["scripts/sync-course-content.mjs"], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    await waitForProcessExit(sync, "sync-course-content");

    const build = spawn(process.execPath, [nextBinPath, "build"], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    await waitForProcessExit(build, "next build");

    server = spawn(process.execPath, [nextBinPath, "start", "--port", String(port)], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });

    await waitFor(
      async () => {
        const result = await tryFetchText(`${baseUrl}/docs/imports/`);
        return result?.status === 200;
      },
      {
        // Windows CI/dev hosts occasionally take > 60 s for `next start` to
        // accept the first request after a fresh build. 120 s covers the
        // observed tail; we still fail loudly if the server is truly stuck.
        timeoutMs: 120_000,
        intervalMs: 500,
        onTimeoutMessage: "Server did not become ready for /docs/imports/.",
      },
    );

    const pageResponse = await fetchResponse(`${baseUrl}/docs/imports/`);
    const pageHtml = await pageResponse.text();
    assert.equal(pageResponse.status, 200);

    const pdfMatch = pageHtml.match(
      /<a[^>]*href="([^"]*download-asset[^"]*filename=handout\.pdf[^"]*)"[^>]*>handout\.pdf<\/a>/i,
    );
    assert.ok(pdfMatch, "Could not find imported PDF link in /docs/imports/ HTML.");
    const pdfUrl = new URL(decodeHtmlAttribute(pdfMatch[1]), `${baseUrl}/docs/imports/`).toString();
    const pdfResponse = await fetchResponse(pdfUrl);
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
    assert.match(
      pdfResponse.headers.get("content-disposition") ?? "",
      /filename\*=UTF-8''handout\.pdf/i,
    );

    const zipMatch = pageHtml.match(
      /<a[^>]*href="([^"]*download-asset[^"]*filename=packet\.zip[^"]*)"[^>]*>packet\.zip<\/a>/i,
    );
    assert.ok(zipMatch, "Could not find imported ZIP link in /docs/imports/ HTML.");
    const zipUrl = new URL(decodeHtmlAttribute(zipMatch[1]), `${baseUrl}/docs/imports/`).toString();
    const zipResponse = await fetchResponse(zipUrl);
    assert.equal(zipResponse.status, 200);
    assert.equal(zipResponse.headers.get("content-type"), "application/zip");
    assert.match(
      zipResponse.headers.get("content-disposition") ?? "",
      /filename\*=UTF-8''packet\.zip/i,
    );

    const videoMatch = pageHtml.match(/<source[^>]*src="([^"]*demo[^"]*)"[^>]*type="video\/mp4"/i);
    assert.ok(videoMatch, "Could not find imported MP4 source in /docs/imports/ HTML.");
    const videoUrl = new URL(videoMatch[1], `${baseUrl}/docs/imports/`).toString();
    const videoResponse = await fetchResponse(videoUrl);
    assert.equal(videoResponse.status, 200);
    assert.equal(videoResponse.headers.get("content-type"), "video/mp4");
  },
);

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createRunDevTestEnv,
  killProcessTreeAndWaitForPort,
  waitForDevServerReady,
} from "./test-harness-env.mjs";

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
      server.close(() => resolve(address.port));
    });
  });

const writeFixtureCourse = async (sourceRoot) => {
  await fs.mkdir(path.join(sourceRoot, "content", "docs", "intro"), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, "public", "img"), { recursive: true });
  await fs.writeFile(
    path.join(sourceRoot, "site.config.ts"),
    `export const siteConfig = {
  logoText: "Dev revision route fixture",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "Development route contract fixture",
  faviconHref: "/img/favicon.ico",
} as const;
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(sourceRoot, "content", "_meta.ts"),
    `const meta = { docs: "Docs" };
export default meta;
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(sourceRoot, "content", "docs", "_meta.ts"),
    `const meta = { intro: {} };
export default meta;
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(sourceRoot, "content", "docs", "intro", "index.mdx"),
    `---
title: "Intro"
---

Development route fixture.
`,
    "utf8",
  );
  await fs.writeFile(path.join(sourceRoot, "public", "img", "favicon.ico"), "", "utf8");
};

test("development discovers revision JSON and SSE routes", { timeout: 120_000 }, async (t) => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-dev-revision-route-"));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await writeFixtureCourse(sourceRoot);

  const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
    cwd: projectRoot,
    env: createRunDevTestEnv({
      label: "dev-revision-route",
      env: process.env,
      overrides: { COURSE_CONTENT_SOURCE: sourceRoot },
    }),
    stdio: "inherit",
    windowsHide: true,
  });

  t.after(async () => {
    await killProcessTreeAndWaitForPort(dev, port);
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  const ready = await waitForDevServerReady({
    child: dev,
    url: `${baseUrl}/api/dev/revision`,
    acceptStatuses: new Set([200, 308]),
  });
  await ready.body?.cancel();

  const revisionResponse = await fetch(`${baseUrl}/api/dev/revision`, {
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(revisionResponse.status, 200);
  assert.match(revisionResponse.headers.get("content-type") ?? "", /application\/json/u);
  const revisionBody = await revisionResponse.json();
  assert.equal(typeof revisionBody.revision, "string");
  assert.notEqual(revisionBody.revision, "");

  const streamResponse = await fetch(`${baseUrl}/api/dev/revision/stream`, {
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get("content-type") ?? "", /text\/event-stream/u);
  assert.ok(streamResponse.body, "SSE route must return a readable body");
  const reader = streamResponse.body.getReader();
  const firstChunk = await reader.read();
  await reader.cancel();
  const streamText = new TextDecoder().decode(firstChunk.value);
  assert.match(streamText, /retry: 1000\n/u);
  assert.match(streamText, /data: \{"revision":"[^"\\]+"\}/u);
});

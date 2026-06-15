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
  cleanupWorktreeDevProcesses,
  createRunDevTestEnv,
  killProcessTreeAndWaitForPort,
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
        typeof onTimeoutMessage === "function"
          ? onTimeoutMessage()
          : (onTimeoutMessage ?? "Timed out"),
      );
    }
    const result = await fn();
    if (result) {
      return;
    }
    await sleep(intervalMs);
  }
};

const fetchResponse = async (url, init) => {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get("location"),
    setCookie: response.headers.get("set-cookie"),
  };
};

const tryFetchResponse = async (url, init) => {
  try {
    return await fetchResponse(url, init);
  } catch {
    return null;
  }
};

const assertRedirectToIntro = (actualLocation) => {
  assert.ok(
    actualLocation === "/docs/intro" || actualLocation === "/docs/intro/",
    `Expected redirect to /docs/intro or /docs/intro/, got: ${actualLocation}`,
  );
};

const waitForRenderedIntroPage = async (baseUrl) => {
  let lastIntroResult = null;
  await waitFor(
    async () => {
      lastIntroResult = await tryFetchResponse(`${baseUrl}/docs/intro/`);
      return lastIntroResult?.status === 200 && lastIntroResult.text.includes("Public intro page.");
    },
    {
      timeoutMs: 180_000,
      intervalMs: 1000,
      onTimeoutMessage: () => {
        const status = lastIntroResult?.status ?? "no response";
        const text = lastIntroResult?.text?.slice(0, 500) ?? "";
        return `Public intro page did not become ready for legacy admin token test. Last /docs/intro/ status: ${status}. Body excerpt: ${text}`;
      },
    },
  );
  return lastIntroResult;
};

const writeFixtureCourseRepo = async (rootDir) => {
  const siteConfig = `export const siteConfig = {
  title: "Admin Fixture",
  logoText: "Admin Fixture",
  githubRepo: "metyatech/admin-fixture",
  projectLink: "https://example.invalid",
  docsRepositoryBase: "https://example.invalid",
  description: "admin mode fixture",
  faviconHref: "/img/favicon.ico",
  adminMode: {
    publicFallbackPath: "/docs/intro",
    protectedLinks: [
      { href: "/docs/teacher-guide", label: "教員ガイド" },
      { href: "/docs/setup-and-troubleshooting", label: "セットアップ・トラブル対応" }
    ]
  }
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
  intro: {},
  "teacher-guide": {
    display: "hidden"
  },
  "setup-and-troubleshooting": {
    display: "hidden"
  }
};

export default meta;
`;

  await fs.mkdir(path.join(rootDir, "content", "docs", "intro"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "content", "docs", "teacher-guide"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "content", "docs", "setup-and-troubleshooting"), {
    recursive: true,
  });
  await fs.mkdir(path.join(rootDir, "public", "img"), { recursive: true });

  await fs.writeFile(path.join(rootDir, "site.config.ts"), siteConfig, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "_meta.ts"), rootMeta, "utf8");
  await fs.writeFile(path.join(rootDir, "content", "docs", "_meta.ts"), docsMeta, "utf8");
  await fs.writeFile(
    path.join(rootDir, "content", "docs", "intro", "index.mdx"),
    "---\ntitle: Intro\n---\n\nPublic intro page.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootDir, "content", "docs", "teacher-guide", "index.mdx"),
    "---\ntitle: Teacher Guide\n---\n\nTeacher Guide\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootDir, "content", "docs", "setup-and-troubleshooting", "index.mdx"),
    "---\ntitle: Setup\n---\n\nSetup page\n",
    "utf8",
  );
  await fs.writeFile(path.join(rootDir, "public", "img", "favicon.ico"), "", "utf8");
};

test(
  "legacy ADMIN_DELETE_TOKEN alone does not enable admin mode anymore",
  { timeout: 5 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-admin-mode-legacy-"));
    const fixtureCourse = path.join(tempRoot, "course");
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    await writeFixtureCourseRepo(fixtureCourse);
    cleanupWorktreeDevProcesses({ projectRoot });

    const dev = spawn(process.execPath, ["scripts/run-dev.mjs", "--port", String(port)], {
      detached: process.platform !== "win32",
      windowsHide: true,
      cwd: projectRoot,
      env: createRunDevTestEnv({
        label: "admin-mode-route-protection-legacy",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
          ADMIN_MODE_TOKEN: "",
          ADMIN_SESSION_SECRET: "",
          ADMIN_DELETE_TOKEN: "legacy-secret",
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      cleanupWorktreeDevProcesses({ projectRoot });
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitForRenderedIntroPage(baseUrl);

    let status = null;
    await waitFor(
      async () => {
        status = await tryFetchResponse(`${baseUrl}/api/admin/mode/`);
        return status?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Admin mode status API did not become ready for legacy token test.",
      },
    );
    assert.equal(status.status, 200);
    assert.match(status.text, /"configured":false/);
    assert.match(status.text, /"tokenConfigured":false/);
    assert.match(status.text, /"unavailableReason":"missing-admin-mode-token"/);
    assert.match(status.text, /ADMIN_MODE_TOKEN/);

    let enableAdmin = null;
    await waitFor(
      async () => {
        enableAdmin = await tryFetchResponse(`${baseUrl}/api/admin/mode/`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ token: "legacy-secret" }),
        });
        return enableAdmin?.status === 503;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Admin mode POST did not become ready for legacy token test.",
      },
    );
    assert.equal(enableAdmin.status, 503);
    assert.equal(enableAdmin.setCookie, null);
    assert.match(enableAdmin.text, /"configured":false/);
    assert.match(enableAdmin.text, /"enabled":false/);
    assert.match(enableAdmin.text, /"unavailableReason":"missing-admin-mode-token"/);

    const teacherGuide = await fetchResponse(`${baseUrl}/docs/teacher-guide/`);
    assert.equal(teacherGuide.status, 307);
    assertRedirectToIntro(teacherGuide.location);

    const teacherGuideWithManualCookie = await fetchResponse(`${baseUrl}/docs/teacher-guide/`, {
      headers: {
        cookie: "course-docs-admin-mode=1",
      },
    });
    assert.equal(teacherGuideWithManualCookie.status, 307);
    assertRedirectToIntro(teacherGuideWithManualCookie.location);
  },
);

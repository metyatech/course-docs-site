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
import { signAdminSession } from "../src/lib/admin/session.ts";

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

const isRenderedIntroPage = (response) =>
  response?.status === 200 && response.text.includes("Public intro page.");

const waitForAdminModeFixtureSynced = async () => {
  const expectedFiles = [
    path.join(projectRoot, "content", "docs", "intro", "index.mdx"),
    path.join(projectRoot, "content", "docs", "teacher-guide", "index.mdx"),
    path.join(projectRoot, "site.config.ts"),
  ];

  await waitFor(
    async () => {
      try {
        const [introText, teacherText, siteConfigText] = await Promise.all([
          fs.readFile(expectedFiles[0], "utf8"),
          fs.readFile(expectedFiles[1], "utf8"),
          fs.readFile(expectedFiles[2], "utf8"),
        ]);
        return (
          introText.includes("Public intro page.") &&
          teacherText.includes("Teacher Guide") &&
          siteConfigText.includes("Admin Fixture")
        );
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 60_000,
      intervalMs: 250,
      onTimeoutMessage: "Admin mode fixture files were not synced into the app tree.",
    },
  );
};

const waitForRenderedIntroPage = async (baseUrl, onTimeoutMessage) => {
  let lastIntroResult = null;
  await waitFor(
    async () => {
      lastIntroResult = await tryFetchResponse(`${baseUrl}/docs/intro/`);
      return isRenderedIntroPage(lastIntroResult);
    },
    {
      timeoutMs: 180_000,
      intervalMs: 1000,
      onTimeoutMessage: () => {
        const status = lastIntroResult?.status ?? "no response";
        const text = lastIntroResult?.text?.slice(0, 500) ?? "";
        return `${onTimeoutMessage} Last /docs/intro/ status: ${status}. Body excerpt: ${text}`;
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
    cookieName: 'course-docs-admin-fixture-session',
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
  "admin-only docs stay hidden from public and open with admin mode enabled",
  { timeout: 5 * 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-admin-mode-"));
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
        label: "admin-mode-route-protection",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
          ADMIN_MODE_TOKEN: "teacher-secret",
          ADMIN_SESSION_SECRET: "fixture-session-secret-at-least-32-bytes",
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      cleanupWorktreeDevProcesses({ projectRoot });
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitForAdminModeFixtureSynced();

    await waitFor(
      async () => {
        const redirectResult = await tryFetchResponse(`${baseUrl}/`);
        return redirectResult?.status === 307;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Server did not become ready for admin-mode route protection test.",
      },
    );

    const root = await fetchResponse(`${baseUrl}/`);
    assert.equal(root.status, 307);
    assertRedirectToIntro(root.location);

    await waitFor(
      async () => {
        const teacherGuideResult = await tryFetchResponse(`${baseUrl}/docs/teacher-guide/`);
        return teacherGuideResult?.status === 307;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Public teacher guide route did not start redirecting.",
      },
    );

    const publicTeacherGuide = await fetchResponse(`${baseUrl}/docs/teacher-guide/`);
    assert.equal(publicTeacherGuide.status, 307);
    assertRedirectToIntro(publicTeacherGuide.location);

    const publicIntro = await waitForRenderedIntroPage(
      baseUrl,
      "Public intro page did not become ready.",
    );
    assert.equal(publicIntro.status, 200);
    assert.ok(
      !publicIntro.text.includes("/docs/teacher-guide"),
      "Public intro page should not expose teacher-guide links.",
    );

    let enableAdmin = null;
    await waitFor(
      async () => {
        enableAdmin = await tryFetchResponse(`${baseUrl}/api/admin/mode/`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ token: "teacher-secret" }),
        });
        return enableAdmin?.status === 200 && Boolean(enableAdmin.setCookie);
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Admin mode API did not enable after token submission.",
      },
    );
    assert.equal(enableAdmin.status, 200);
    assert.ok(enableAdmin.setCookie, "Expected admin mode API to set a cookie.");
    assert.match(
      enableAdmin.setCookie,
      /^course-docs-admin-fixture-session=[^;]+/,
      "Expected Set-Cookie to use the custom fixture cookie name.",
    );
    assert.match(enableAdmin.setCookie, /HttpOnly/i, "Expected Set-Cookie to be HttpOnly.");
    assert.match(
      enableAdmin.setCookie,
      /SameSite=Lax/i,
      "Expected Set-Cookie to use SameSite=Lax.",
    );
    assert.match(enableAdmin.setCookie, /Path=\//, "Expected Set-Cookie to scope to Path=/.");

    const cookieHeader = enableAdmin.setCookie.split(";", 1)[0];

    await waitFor(
      async () => {
        const adminTeacherGuide = await tryFetchResponse(`${baseUrl}/docs/teacher-guide/`, {
          headers: {
            cookie: cookieHeader,
          },
        });
        return adminTeacherGuide?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Teacher guide did not open after enabling admin mode.",
      },
    );

    const adminTeacherGuide = await fetchResponse(`${baseUrl}/docs/teacher-guide/`, {
      headers: {
        cookie: cookieHeader,
      },
    });
    assert.equal(adminTeacherGuide.status, 200);
    assert.match(adminTeacherGuide.text, /Teacher Guide/);

    let disableAdmin = null;
    await waitFor(
      async () => {
        disableAdmin = await tryFetchResponse(`${baseUrl}/api/admin/mode/`, {
          method: "DELETE",
          headers: {
            cookie: cookieHeader,
          },
        });
        return disableAdmin?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Admin mode API did not disable after DELETE.",
      },
    );
    assert.equal(disableAdmin.status, 200);

    const teacherGuideAfterDisable = await fetchResponse(`${baseUrl}/docs/teacher-guide/`);
    assert.equal(teacherGuideAfterDisable.status, 307);
    assertRedirectToIntro(teacherGuideAfterDisable.location);
  },
);

test(
  "identical admin token and session secret fail closed across HTTP routes",
  { timeout: 5 * 60_000 },
  async (t) => {
    const identicalSecret = "identical-admin-token-and-session-secret-32-bytes";
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-admin-identical-"));
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
        label: "admin-mode-identical-secrets",
        env: process.env,
        overrides: {
          COURSE_CONTENT_SOURCE: fixtureCourse,
          // Intentionally identical: the admin login code and the session
          // signing secret share one value, which must fail the configured gate.
          ADMIN_MODE_TOKEN: identicalSecret,
          ADMIN_SESSION_SECRET: identicalSecret,
        },
      }),
      stdio: "inherit",
    });

    t.after(async () => {
      await killProcessTreeAndWaitForPort(dev, port);
      cleanupWorktreeDevProcesses({ projectRoot });
      await fs.rm(tempRoot, { recursive: true, force: true });
    });

    await waitForAdminModeFixtureSynced();

    // GET status API: configured/enabled must be false and the status must
    // explain why (secrets are not distinct).
    let statusResult = null;
    await waitFor(
      async () => {
        statusResult = await tryFetchResponse(`${baseUrl}/api/admin/mode/`);
        return statusResult?.status === 200;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Admin mode status API did not become ready.",
      },
    );
    assert.equal(statusResult.status, 200);
    const statusBody = JSON.parse(statusResult.text);
    assert.equal(statusBody.configured, false);
    assert.equal(statusBody.enabled, false);
    assert.equal(statusBody.secretsDistinct, false);
    assert.equal(statusBody.unavailableReason, "admin-token-must-differ-from-session-secret");

    // POST login API: must fail closed with 503 and issue no session cookie.
    const loginResult = await fetchResponse(`${baseUrl}/api/admin/mode/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: identicalSecret }),
    });
    assert.equal(loginResult.status, 503);
    assert.equal(loginResult.setCookie, null);
    const loginBody = JSON.parse(loginResult.text);
    assert.equal(loginBody.configured, false);
    assert.equal(loginBody.enabled, false);
    assert.equal(loginBody.secretsDistinct, false);
    assert.equal(loginBody.unavailableReason, "admin-token-must-differ-from-session-secret");

    // A manually forged, correctly-signed cookie (same secret) must NOT grant
    // access, because the configured gate is closed when the secrets match.
    const forgedCookie = await signAdminSession(identicalSecret);
    const cookieHeader = `course-docs-admin-fixture-session=${forgedCookie}`;

    let forgedTeacherGuide = null;
    await waitFor(
      async () => {
        forgedTeacherGuide = await tryFetchResponse(`${baseUrl}/docs/teacher-guide/`, {
          headers: { cookie: cookieHeader },
        });
        return forgedTeacherGuide?.status === 307;
      },
      {
        timeoutMs: 60_000,
        intervalMs: 500,
        onTimeoutMessage: "Protected route did not fail closed for forged cookie.",
      },
    );
    assert.equal(forgedTeacherGuide.status, 307);
    assertRedirectToIntro(forgedTeacherGuide.location);

    // The public layout must also respect configured=false: even with the
    // forged cookie, the admin-only link must not appear on the public page.
    await waitForRenderedIntroPage(baseUrl, "Public intro page did not become ready.");
    const forgedIntro = await fetchResponse(`${baseUrl}/docs/intro/`, {
      headers: { cookie: cookieHeader },
    });
    assert.equal(forgedIntro.status, 200);
    assert.ok(
      !forgedIntro.text.includes("/docs/teacher-guide"),
      "Forged cookie must not reveal teacher-guide links on the public page.",
    );
  },
);

import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const BASE_DOMAIN = ".vercel.app";
const REQUEST_TIMEOUT_MS = 30_000;
const requiredUrl = (siteId, pathname) => `https://${siteId}${BASE_DOMAIN}${pathname}`;

const parseSites = () => {
  let matrix;
  try {
    matrix = JSON.parse(process.env.COURSE_RELEASE_MATRIX ?? "");
  } catch {
    throw new Error("COURSE_RELEASE_MATRIX must be valid JSON.");
  }
  if (!Array.isArray(matrix?.include) || matrix.include.length === 0) {
    throw new Error("Production smoke requires a non-empty discovered course matrix.");
  }
  const siteIds = matrix.include.map((site) => site.siteId);
  if (siteIds.some((siteId) => typeof siteId !== "string" || !/^[a-z0-9-]+$/u.test(siteId))) {
    throw new Error("Production smoke received an invalid discovered site ID.");
  }
  if (new Set(siteIds).size !== siteIds.length) {
    throw new Error("Production smoke received duplicate site IDs.");
  }
  return siteIds;
};

const request = async (url, method = "GET") => {
  const response = await fetch(url, {
    method,
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  process.stdout.write(`${method} ${response.status} ${response.url}\n`);
  return response;
};

const requireStatus = async (siteId, pathname, expectedStatus = 200, method = "GET") => {
  const response = await request(requiredUrl(siteId, pathname), method);
  assert.equal(
    response.status,
    expectedStatus,
    `${siteId}${pathname} must return ${expectedStatus}, got ${response.status}.`,
  );
  return response;
};

const smokeGeneralRoutes = async (siteId) => {
  const root = await requireStatus(siteId, "/");
  const representativePath = new URL(root.url).pathname;
  assert.ok(
    representativePath.startsWith("/docs/"),
    `${siteId}/ must resolve to its representative documentation page.`,
  );
  await requireStatus(siteId, `${representativePath.replace(/\/+$/u, "")}.mdx`, 404);
  await requireStatus(siteId, `${representativePath}index.mdx`, 404);
  await requireStatus(siteId, "/docs/intro/index.mdx", 404);
  await requireStatus(siteId, "/docs/_meta.ts", 404);
  await requireStatus(siteId, "/_meta.ts", 404);
  await requireStatus(siteId, "/asset/", 404);
  await requireStatus(siteId, "/api/dev/revision/", 404);
  await requireStatus(siteId, "/api/dev/revision/stream/", 404);
  await requireStatus(siteId, "/dev/tutorial-shots/", 404);
  await requireStatus(siteId, "/api/dev/tutorial-shots/", 404);
  await requireStatus(siteId, "/api/dev/tutorial-shots/save/", 404);
  await requireStatus(siteId, "/api/dev/tutorial-shots/image/", 404);
};

const smokeOpenCampus = async () => {
  const siteId = "open-campus-unreal-90min";
  await requireStatus(siteId, "/docs/intro/");
  await requireStatus(siteId, "/_course-assets/docs/intro/assets/demo-complete.mp4", 200, "HEAD");
  await requireStatus(siteId, "/_course-assets/docs/intro/img/video-poster.svg", 200, "HEAD");
};

const smokeGameDevelopment = async () => {
  const siteId = "game-development-course-docs";
  await requireStatus(siteId, "/docs/game-programming/night-escape-1/");
  await requireStatus(
    siteId,
    "/_course-assets/docs/game-programming/night-escape-1/night-escape-stage-layout.svg",
    200,
    "HEAD",
  );
};

const smokeProgramming = async () => {
  const siteId = "programming-course-docs";
  await requireStatus(siteId, "/submissions/");
  await requireStatus(
    siteId,
    "/_course-assets/docs/html-basics/text-markup/assets/text-markup-complete.zip",
    200,
    "HEAD",
  );

  const adminModeResponse = await request(requiredUrl(siteId, "/api/admin/mode"));
  assert.equal(adminModeResponse.status, 200, "Programming /api/admin/mode must return 200.");
  const adminMode = await adminModeResponse.json();
  assert.equal(adminMode.configured, true, "Programming admin mode must be configured.");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const supabaseErrors = [];
    const commentReads = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/rest/v1/")) {
        if (response.status() >= 400) {
          supabaseErrors.push(`${response.status()} ${url}`);
        }
        if (url.includes("/rest/v1/work_comments")) {
          commentReads.push(response.status());
        }
      }
    });

    await page.goto(requiredUrl(siteId, "/submissions/"), { waitUntil: "domcontentloaded" });
    const commentButton = page.getByTestId("comment-open").first();
    await expect(commentButton).toBeVisible({ timeout: REQUEST_TIMEOUT_MS });
    await expect
      .poll(() => commentReads.length, { timeout: REQUEST_TIMEOUT_MS })
      .toBeGreaterThan(0);
    assert.deepEqual(supabaseErrors, [], "Programming Supabase requests must not fail.");
    assert.ok(
      commentReads.every((status) => status >= 200 && status < 300),
      `Programming comment reads must succeed; received ${commentReads.join(", ")}.`,
    );

    await commentButton.click();
    await expect(page.getByTestId("comment-panel")).toBeVisible();
    await expect(page.getByText("コメントの読み込みに失敗しました。", { exact: true })).toHaveCount(
      0,
    );
    process.stdout.write("Programming comments and admin mode smoke checks passed.\n");
  } finally {
    await browser.close();
  }
};

const run = async () => {
  const siteIds = parseSites();
  await Promise.all(siteIds.map(smokeGeneralRoutes));
  await Promise.all([smokeOpenCampus(), smokeGameDevelopment(), smokeProgramming()]);
  process.stdout.write(`Production smoke passed for ${siteIds.length} sites.\n`);
};

run().catch((error) => {
  console.error(`[smoke-production-sites] ${error.message}`);
  process.exitCode = 1;
});

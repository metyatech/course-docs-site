const { expect, test } = require('@playwright/test');
const { resolveCourseKey } = require('./course-defaults.cjs');

const currentCourseKey = resolveCourseKey(process.env.COURSE_CONTENT_SOURCE);

const parseCssUrl = (cssUrl) => {
  const match = cssUrl.match(/^url\((['"]?)(.+)\1\)$/);
  if (!match) {
    throw new Error(`Could not parse CSS url() value: ${cssUrl}`);
  }
  return match[2];
};

const findBackgroundImageInPreview = async (page, expectedText, selector) => {
  const handle = await page.waitForFunction(
    ({ frameText, targetSelector }) => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      for (const frame of frames) {
        try {
          const doc = frame.contentDocument;
          const bodyText = doc?.body?.innerText ?? '';
          if (!bodyText.includes(frameText)) {
            continue;
          }
          const element = doc.querySelector(targetSelector);
          if (!element) {
            continue;
          }
          const backgroundImage = getComputedStyle(element).backgroundImage;
          if (backgroundImage && backgroundImage !== 'none') {
            return backgroundImage;
          }
        } catch {
          // Ignore transient iframe reloads and keep polling.
        }
      }
      return null;
    },
    { frameText: expectedText, targetSelector: selector },
    { timeout: 30_000 },
  );

  return handle.jsonValue();
};

test('backgrounds page keeps background images visible in code previews', async ({ page }) => {
  test.skip(
    currentCourseKey !== 'programming-course-docs',
    'backgrounds page exists only in programming-course-docs',
  );

  const response = await page.goto('/docs/css-basics/backgrounds/');
  if (!response) {
    throw new Error('Response is null');
  }
  expect(response.ok()).toBeTruthy();

  const backgroundImage = await findBackgroundImageInPreview(page, '背景画像のサンプル', 'div');
  expect(backgroundImage).not.toBe('none');
  const backgroundAssetUrl = parseCssUrl(backgroundImage);
  expect(backgroundAssetUrl).toContain('/_next/static/media/background-sample');
  const backgroundAssetResponse = await page.request.get(backgroundAssetUrl);
  expect(backgroundAssetResponse.ok()).toBeTruthy();
  expect(backgroundAssetResponse.headers()['content-type']).toContain('image/');

  const parallaxImage = await findBackgroundImageInPreview(
    page,
    '背景が固定されている領域1',
    '.parallax1',
  );
  expect(parallaxImage).not.toBe('none');
  const parallaxAssetUrl = parseCssUrl(parallaxImage);
  expect(parallaxAssetUrl).toContain('/_next/static/media/parallax1');
  const parallaxAssetResponse = await page.request.get(parallaxAssetUrl);
  expect(parallaxAssetResponse.ok()).toBeTruthy();
  expect(parallaxAssetResponse.headers()['content-type']).toContain('image/');
});

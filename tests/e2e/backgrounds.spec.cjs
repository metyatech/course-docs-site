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

const expectServedImageBytes = async (response, expectedKind) => {
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toContain('image/');

  const body = await response.body();
  const utf8Prefix = body.subarray(0, 32).toString('utf8');
  expect(utf8Prefix.startsWith('export default')).toBeFalsy();

  if (expectedKind === 'png') {
    expect(Array.from(body.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return;
  }

  if (expectedKind === 'jpeg') {
    expect(Array.from(body.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  }
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
  await expectServedImageBytes(backgroundAssetResponse, 'png');

  const parallaxImage = await findBackgroundImageInPreview(
    page,
    '背景が固定されている領域1',
    '.parallax1',
  );
  expect(parallaxImage).not.toBe('none');
  const parallaxAssetUrl = parseCssUrl(parallaxImage);
  expect(parallaxAssetUrl).toContain('/_next/static/media/parallax1');
  const parallaxAssetResponse = await page.request.get(parallaxAssetUrl);
  await expectServedImageBytes(parallaxAssetResponse, 'jpeg');
});

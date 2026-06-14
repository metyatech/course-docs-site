const { expect, test } = require('@playwright/test');
const { suiteConfig } = require('./suite-config.cjs');

test('home renders (redirect ok)', async ({ page }) => {
  const response = await page.goto('/');
  if (!response) throw new Error('Response is null');
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('main').first()).toBeVisible();
});

test('docs intro renders', async ({ page }) => {
  const response = await page.goto(suiteConfig.docsIntroPath);
  if (!response) throw new Error('Response is null');
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('main').first()).toBeVisible();
});

test('submissions renders', async ({ page }) => {
  if (!suiteConfig.enableSubmissions) {
    test.skip(true, 'submissions page is disabled for this course');
  }

  const response = await page.goto(suiteConfig.submissionsPath);
  if (!response) throw new Error('Response is null');
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('main').first()).toBeVisible();
  await expect(page.locator('header').first()).toBeVisible();
  await expect(page.locator('footer').first()).toBeVisible();
});


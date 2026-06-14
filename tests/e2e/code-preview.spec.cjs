const { expect, test } = require('@playwright/test');
const { suiteConfig } = require('./suite-config.cjs');

test('code preview renders editors', async ({ page }) => {
  if (!suiteConfig.enableCodePreview) {
    test.skip(true, 'code preview is disabled for this course');
  }

  const response = await page.goto(suiteConfig.codePreviewPath);
  if (!response) throw new Error('Response is null');
  expect(response.ok()).toBeTruthy();

  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText(
    suiteConfig.codePreviewExpectedText,
  );
});


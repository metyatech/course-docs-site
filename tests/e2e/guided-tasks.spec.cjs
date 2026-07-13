const { expect, test } = require('@playwright/test');

const isJavaScriptCourse = (process.env.COURSE_CONTENT_SOURCE ?? '').includes(
  'javascript-course-docs',
);

test('conditionals page renders the Answer-only guided task flow', async ({ page }) => {
  if (!isJavaScriptCourse) {
    test.skip(true, 'guided task assertions apply to the JavaScript course');
  }

  const response = await page.goto('/docs/basics/conditionals-if-elseif');
  if (!response) throw new Error('Response is null');
  expect(response.ok()).toBeTruthy();

  const quickChecks = page.locator('.rensyuBlock.rensyuQuickCheck');
  await expect(quickChecks).toHaveCount(4);
  await expect(page.locator('#metyatech-exercise-style')).toHaveCount(1);
  await expect(quickChecks.locator('.rensyuQuickCheckTitle')).toHaveText([
    '理解度確認',
    '理解度確認',
    '理解度確認',
    '理解度確認',
  ]);

  const firstQuickCheck = quickChecks.first();
  const hintDetails = firstQuickCheck.locator('details.rensyuHint');
  const answerDetails = firstQuickCheck.locator('details.rensyuKaitou');
  await expect(hintDetails).not.toHaveAttribute('open', '');
  await expect(answerDetails).not.toHaveAttribute('open', '');
  await expect(firstQuickCheck.locator('details > summary')).toHaveText([
    'ヒントを見る',
    '答えを見る',
  ]);

  expect(await firstQuickCheck.evaluate((element) => {
    const hint = element.querySelector('details.rensyuHint');
    const answer = element.querySelector('details.rensyuKaitou');
    return Boolean(hint && answer && hint.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBeTruthy();

  expect(await page.locator('.rensyuBlock:not(.rensyuQuickCheck)').count()).toBeGreaterThan(0);

  const hintSummary = hintDetails.locator('summary');
  await hintSummary.focus();
  await page.keyboard.press('Space');
  await expect(hintDetails).toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await expect(hintDetails).not.toHaveAttribute('open', '');

  const lineNumbers = page.getByRole('button', { name: '行番号を表示' }).first();
  await lineNumbers.click();
  await expect(page.getByRole('button', { name: '行番号を隠す' }).first()).toBeVisible();
});

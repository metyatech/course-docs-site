const { expect, test } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const path = require("node:path");

test("optional goals and Hint counts render an accessible task flow", async ({ page }) => {
  test.skip(
    !(process.env.COURSE_CONTENT_SOURCE ?? "").includes("optional-goals"),
    "requires optional-goals fixture",
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/docs");
  expect(response.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: /^数値を選ぶ/ })).toBeVisible();
  await expect(page.locator(".tutorial-section__goal")).toHaveCount(1);
  await expect(page.locator(".tutorial-section__goal")).toHaveText("理由を確かめながら進めます");
  await expect(page.locator('.tutorial-section[data-section-depth="1"]')).toHaveCount(1);
  const tasks = page.locator(".rensyuBlock");
  await expect(tasks).toHaveCount(4);
  for (const [index, hints] of [0, 0, 1, 2].entries()) {
    await expect(tasks.nth(index).locator("details.rensyuHint")).toHaveCount(hints);
    await expect(tasks.nth(index).locator("details.rensyuKaitou")).toHaveCount(1);
  }

  const answer = tasks.first().locator("details.rensyuKaitou");
  const summary = answer.locator("summary");
  await page.keyboard.press("Control+Home");
  for (
    let step = 0;
    step < 80 && !(await summary.evaluate((node) => node === document.activeElement));
    step++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(summary).toBeFocused();
  expect(
    await summary.evaluate((node) => {
      const style = getComputedStyle(node);
      return (
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== "none"
      );
    }),
  ).toBeTruthy();
  await page.keyboard.press("Enter");
  await expect(answer).toHaveAttribute("open", "");
  await expect(answer.getByText("5です。5は3より大きい数値です。", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(answer).not.toHaveAttribute("open", "");

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.keyboard.press("Control+Home");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    const accessibility = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    if (process.env.OPTIONAL_GOALS_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(process.env.OPTIONAL_GOALS_SCREENSHOT_DIR, `optional-goals-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.reload();
  await expect(page.locator(".tutorial-section__goal")).toHaveCount(1);
  await expect(tasks.first().locator("details.rensyuHint")).toHaveCount(0);
  await expect(tasks.first().locator("details.rensyuKaitou")).toBeVisible();
  expect(errors).toEqual([]);
});

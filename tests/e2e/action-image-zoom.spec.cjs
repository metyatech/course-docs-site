const { expect, test } = require("@playwright/test");

test("tutorial Action images can open the zoom modal", async ({ page }) => {
  const response = await page.goto("/docs/student-guide");
  if (!response) {
    throw new Error("Response is null");
  }
  test.skip(
    response.status() === 404,
    "student-guide page exists only for courses that ship the open-campus tutorial content",
  );
  expect(response.ok()).toBeTruthy();

  const firstActionImage = page.locator(".tutorial-action img").first();
  test.skip(
    (await page.locator(".tutorial-action img").count()) === 0,
    "tutorial Action image zoom is only relevant when tutorial action screenshots are present",
  );
  await firstActionImage.scrollIntoViewIfNeeded();
  await expect(firstActionImage).toBeVisible();

  const zoomButton = page.locator(".tutorial-action [data-rmiz-btn-zoom]").first();
  await expect(zoomButton).toBeVisible();
  await firstActionImage.click();

  const modal = page.locator("[data-rmiz-modal][open]");
  await expect(modal).toBeVisible();
  await expect(modal.locator("[data-rmiz-modal-img]")).toBeVisible();

  const unzoomButton = modal.locator("[data-rmiz-btn-unzoom]");
  await expect(unzoomButton).toBeVisible();
  await unzoomButton.click();

  await expect(modal).toHaveCount(0);
});

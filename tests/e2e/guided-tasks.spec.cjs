const { expect, test } = require("@playwright/test");

const isJavaScriptCourse = (process.env.COURSE_CONTENT_SOURCE ?? "").includes(
  "javascript-course-docs",
);

test("conditionals page renders the Answer-only guided task flow", async ({ page }) => {
  if (!isJavaScriptCourse) {
    test.skip(true, "guided task assertions apply to the JavaScript course");
  }

  const response = await page.goto("/docs/basics/conditionals-if-elseif");
  if (!response) throw new Error("Response is null");
  expect(response.ok()).toBeTruthy();

  const quickChecks = page.locator(".rensyuBlock.rensyuQuickCheck");
  await expect(quickChecks).toHaveCount(4);
  await expect(page.locator("#metyatech-exercise-style")).toHaveCount(1);
  await expect(quickChecks.locator(".rensyuQuickCheckTitle")).toHaveText([
    "理解度確認",
    "理解度確認",
    "理解度確認",
    "理解度確認",
  ]);

  const firstQuickCheck = quickChecks.first();
  const exercises = page.locator(".rensyuBlock:not(.rensyuQuickCheck)");
  expect(await exercises.count()).toBeGreaterThan(0);
  const firstExercise = exercises.first();
  const hintDetails = firstQuickCheck.locator("details.rensyuHint");
  const answerDetails = firstQuickCheck.locator("details.rensyuKaitou");
  await expect(hintDetails).not.toHaveAttribute("open", "");
  await expect(answerDetails).not.toHaveAttribute("open", "");
  await expect(firstQuickCheck.locator("details > summary")).toHaveText([
    "ヒントを見る",
    "解答を見る",
  ]);
  await expect(firstExercise.locator("details.rensyuKaitou > summary")).toHaveText("解答を見る");

  await expect(firstExercise.locator(".rensyuTaskHeader")).toHaveText("演習");
  await expect(
    firstExercise.locator('.rensyuTaskHeader [data-guided-task-icon="pencil"]'),
  ).toHaveCount(1);
  expect(
    await firstExercise
      .locator(".rensyuTaskHeader")
      .evaluate((element) => element.textContent?.trim()),
  ).toBe("演習");

  const summaryShape = async (summary) =>
    summary.evaluate((element) => ({
      className: element.getAttribute("class"),
      childClasses: Array.from(element.children).map((child) => child.getAttribute("class")),
      labelChildClasses: Array.from(
        element.querySelector(".rensyuSummaryLabel")?.children ?? [],
      ).map((child) => child.getAttribute("class")),
    }));

  expect(await summaryShape(firstQuickCheck.locator("details.rensyuHint > summary"))).toEqual(
    await summaryShape(firstExercise.locator("details.rensyuHint > summary")),
  );
  expect(await summaryShape(firstQuickCheck.locator("details.rensyuKaitou > summary"))).toEqual(
    await summaryShape(firstExercise.locator("details.rensyuKaitou > summary")),
  );

  await expect(firstQuickCheck.locator('[data-guided-task-icon="lightbulb"]')).toHaveCount(1);
  await expect(firstQuickCheck.locator('[data-guided-task-icon="checkCircle"]')).toHaveCount(2);
  const iconAttributes = await firstQuickCheck
    .locator("svg[data-guided-task-icon]")
    .evaluateAll((icons) =>
      icons.map((icon) => ({
        icon: icon.getAttribute("data-guided-task-icon"),
        ariaHidden: icon.getAttribute("aria-hidden"),
        focusable: icon.getAttribute("focusable"),
      })),
    );
  expect(
    iconAttributes.every((icon) => icon.ariaHidden === "true" && icon.focusable === "false"),
  ).toBeTruthy();
  await expect(firstQuickCheck.locator("details.rensyuHint > summary > *")).toHaveCount(2);
  expect(
    await firstQuickCheck
      .locator("details > summary")
      .evaluateAll((summaries) =>
        summaries.every(
          (summary) =>
            getComputedStyle(summary).listStyleType === "none" &&
            getComputedStyle(summary, "::marker").content === '""',
        ),
      ),
  ).toBeTruthy();

  const visualStyles = await page.evaluate(() => {
    const getStyles = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const styles = getComputedStyle(element);
      return {
        borderTopWidth: styles.borderTopWidth,
        boxShadow: styles.boxShadow,
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
      };
    };

    return {
      exercise: getStyles(".rensyuBlock:not(.rensyuQuickCheck)"),
      quickCheck: getStyles(".rensyuBlock.rensyuQuickCheck"),
      hint: getStyles(".rensyuBlock.rensyuQuickCheck .rensyuHint"),
      answer: getStyles(".rensyuBlock.rensyuQuickCheck .rensyuKaitou"),
    };
  });
  expect(visualStyles.exercise?.borderTopWidth).toBe("5px");
  expect(visualStyles.quickCheck?.borderTopWidth).toBe("3px");
  expect(visualStyles.exercise?.boxShadow).not.toBe("none");
  expect(visualStyles.quickCheck?.boxShadow).toBe("none");
  expect(visualStyles.hint?.backgroundColor).not.toBe(visualStyles.answer?.backgroundColor);
  expect(visualStyles.hint?.borderColor).not.toBe(visualStyles.answer?.borderColor);

  const allGuidedDetails = page.locator(
    ".rensyuBlock details.rensyuHint, .rensyuBlock details.rensyuKaitou",
  );
  expect(
    await allGuidedDetails.evaluateAll((details) =>
      details.every((detail) => !detail.hasAttribute("open")),
    ),
  ).toBeTruthy();

  expect(
    await firstQuickCheck.evaluate((element) => {
      const hint = element.querySelector("details.rensyuHint");
      const answer = element.querySelector("details.rensyuKaitou");
      return Boolean(
        hint && answer && hint.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBeTruthy();

  expect(await page.locator(".rensyuBlock:not(.rensyuQuickCheck)").count()).toBeGreaterThan(0);

  const hintSummary = hintDetails.locator("summary");
  await hintSummary.focus();
  const focusStyles = await hintSummary.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { outlineStyle: styles.outlineStyle, outlineWidth: styles.outlineWidth };
  });
  expect(focusStyles.outlineStyle).not.toBe("none");
  expect(focusStyles.outlineWidth).not.toBe("0px");
  await page.keyboard.press("Space");
  await expect(hintDetails).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(hintDetails).not.toHaveAttribute("open", "");

  const answerSummary = answerDetails.locator("summary");
  await answerSummary.focus();
  await page.keyboard.press("Enter");
  await expect(answerDetails).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(answerDetails).not.toHaveAttribute("open", "");

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("html.dark")).toHaveCount(1);
  const darkStyles = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const styles = getComputedStyle(element);
      return {
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        boxShadow: styles.boxShadow,
      };
    };
    return {
      exercise: read(".rensyuBlock:not(.rensyuQuickCheck)"),
      quickCheck: read(".rensyuBlock.rensyuQuickCheck"),
      hint: read(".rensyuBlock.rensyuQuickCheck .rensyuHint"),
      answer: read(".rensyuBlock.rensyuQuickCheck .rensyuKaitou"),
    };
  });
  expect(darkStyles.exercise?.boxShadow).not.toBe("none");
  expect(darkStyles.quickCheck?.boxShadow).toBe("none");
  expect(darkStyles.hint?.backgroundColor).not.toBe(darkStyles.answer?.backgroundColor);
  expect(darkStyles.hint?.borderColor).not.toBe(darkStyles.answer?.borderColor);

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.locator("#metyatech-exercise-style")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBeTruthy();

  const lineNumbers = page.getByRole("button", { name: "行番号を表示" }).first();
  await lineNumbers.click();
  await expect(page.getByRole("button", { name: "行番号を隠す" }).first()).toBeVisible();
});

const { expect, test } = require("@playwright/test");

const isJavaScriptCourse = (process.env.COURSE_CONTENT_SOURCE ?? "").includes(
  "javascript-course-docs",
);

const MIN_BACKGROUND_CONTRAST = 1.1;
const MIN_BORDER_CONTRAST = 3;

const parseCssColor = (value) => {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    throw new Error(`Unsupported computed color: ${value}`);
  }

  const channels = match[1]
    .trim()
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (channels.length < 3 || channels.some(Number.isNaN)) {
    throw new Error(`Invalid computed color: ${value}`);
  }

  return channels.slice(0, 3);
};

const relativeLuminance = (color) => {
  const [red, green, blue] = parseCssColor(color).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground, background) => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

test("guided task boundaries meet contrast requirements in every state", async ({ page }) => {
  if (!isJavaScriptCourse) {
    test.skip(true, "guided task assertions apply to the JavaScript course");
  }

  const response = await page.goto("/docs/basics/conditionals-if-elseif");
  if (!response) throw new Error("Response is null");
  expect(response.ok()).toBeTruthy();

  const quickCheck = page.locator(".rensyuBlock.rensyuQuickCheck").first();
  const exercise = page.locator(".rensyuBlock:not(.rensyuQuickCheck)").first();
  const surfaces = [
    ["QuickCheck Hint", quickCheck.locator("details.rensyuHint")],
    ["QuickCheck Answer", quickCheck.locator("details.rensyuKaitou")],
    ["Exercise Hint", exercise.locator("details.rensyuHint")],
    ["Exercise Answer", exercise.locator("details.rensyuKaitou")],
  ];

  for (const [label, details] of surfaces) {
    await expect(details, `${label}: guided task surface exists`).toHaveCount(1);
  }

  for (const theme of ["light", "dark"]) {
    await page.evaluate((currentTheme) => {
      document.documentElement.classList.toggle("dark", currentTheme === "dark");
    }, theme);

    for (const [state, open] of [
      ["closed", false],
      ["open", true],
    ]) {
      for (const [label, details] of surfaces) {
        await details.evaluate((element, shouldOpen) => {
          element.open = shouldOpen;
        }, open);

        const colors = await details.evaluate((element) => {
          const parseColor = (value) => {
            const match = value.match(/rgba?\(([^)]+)\)/);
            if (!match) return null;
            const values = match[1]
              .trim()
              .split(/[\s,/]+/)
              .filter(Boolean)
              .map(Number);
            if (values.length < 3 || values.some(Number.isNaN)) return null;
            return {
              red: values[0],
              green: values[1],
              blue: values[2],
              alpha: values.length > 3 ? values[3] : 1,
            };
          };

          const blend = (foreground, background) => {
            const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
            return {
              red:
                (foreground.red * foreground.alpha +
                  background.red * background.alpha * (1 - foreground.alpha)) /
                alpha,
              green:
                (foreground.green * foreground.alpha +
                  background.green * background.alpha * (1 - foreground.alpha)) /
                alpha,
              blue:
                (foreground.blue * foreground.alpha +
                  background.blue * background.alpha * (1 - foreground.alpha)) /
                alpha,
              alpha,
            };
          };

          const toRgb = (color) =>
            `rgb(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)})`;

          const effectiveBackground = (start) => {
            const layers = [];
            for (let current = start; current; current = current.parentElement) {
              const color = parseColor(getComputedStyle(current).backgroundColor);
              if (color && color.alpha > 0) {
                layers.push(color);
                if (color.alpha >= 1) break;
              }
            }

            let result = { red: 255, green: 255, blue: 255, alpha: 1 };
            for (let index = layers.length - 1; index >= 0; index -= 1) {
              result = blend(layers[index], result);
            }
            return result;
          };

          const styles = getComputedStyle(element);
          const parentBackground = effectiveBackground(element.parentElement);
          const elementBackground = effectiveBackground(element);
          const border = parseColor(styles.borderTopColor);
          if (!border) {
            throw new Error(`Unable to parse border color: ${styles.borderTopColor}`);
          }

          return {
            backgroundColor: styles.backgroundColor,
            parentBackgroundColor: toRgb(parentBackground),
            effectiveBackgroundColor: toRgb(elementBackground),
            borderColor: styles.borderTopColor,
            effectiveBorderColor: toRgb(blend(border, parentBackground)),
          };
        });

        const backgroundContrast = contrastRatio(
          colors.effectiveBackgroundColor,
          colors.parentBackgroundColor,
        );
        const borderContrast = contrastRatio(
          colors.effectiveBorderColor,
          colors.parentBackgroundColor,
        );
        const diagnostic = [
          `${label} ${theme} ${state}`,
          `backgroundColor=${colors.backgroundColor}`,
          `parentBackgroundColor=${colors.parentBackgroundColor}`,
          `borderColor=${colors.borderColor}`,
          `backgroundContrast=${backgroundContrast.toFixed(2)}`,
          `borderContrast=${borderContrast.toFixed(2)}`,
        ].join(" ");

        expect(
          backgroundContrast >= MIN_BACKGROUND_CONTRAST || borderContrast >= MIN_BORDER_CONTRAST,
          diagnostic,
        ).toBeTruthy();
      }
    }
  }
});

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

  const assertHoverSurface = async (details, label) => {
    const summary = details.locator(":scope > summary");
    await summary.scrollIntoViewIfNeeded();
    const metrics = await details.evaluate((element) => {
      const summaryElement = element.querySelector(":scope > summary");
      const contentElement = element.querySelector(
        ":scope > .rensyuHintNaiyou, :scope > .rensyuKaitouNaiyou",
      );
      if (!summaryElement || !contentElement) return null;

      const detailsStyle = getComputedStyle(element);
      const summaryStyle = getComputedStyle(summaryElement);
      const contentStyle = getComputedStyle(contentElement);
      const detailsRect = element.getBoundingClientRect();
      const summaryRect = summaryElement.getBoundingClientRect();
      const parsePixels = (value) => Number.parseFloat(value) || 0;

      return {
        details: {
          left: detailsRect.left,
          right: detailsRect.right,
          top: detailsRect.top,
          borderLeft: parsePixels(detailsStyle.borderLeftWidth),
          borderRight: parsePixels(detailsStyle.borderRightWidth),
          paddingLeft: parsePixels(detailsStyle.paddingLeft),
          paddingRight: parsePixels(detailsStyle.paddingRight),
          overflow: detailsStyle.overflow,
        },
        summary: {
          left: summaryRect.left,
          right: summaryRect.right,
          top: summaryRect.top,
          height: summaryRect.height,
          paddingLeft: parsePixels(summaryStyle.paddingLeft),
          paddingRight: parsePixels(summaryStyle.paddingRight),
          backgroundColor: summaryStyle.backgroundColor,
        },
        content: {
          marginLeft: parsePixels(contentStyle.marginLeft),
          marginRight: parsePixels(contentStyle.marginRight),
        },
      };
    });

    expect(metrics, `${label}: layout metrics should exist`).not.toBeNull();
    expect(metrics.details.paddingLeft, `${label}: details left padding`).toBe(0);
    expect(metrics.details.paddingRight, `${label}: details right padding`).toBe(0);
    expect(metrics.summary.paddingLeft, `${label}: summary left padding`).toBeCloseTo(12, 0);
    expect(metrics.summary.paddingRight, `${label}: summary right padding`).toBeCloseTo(12, 0);
    expect(metrics.content.marginLeft, `${label}: content left margin`).toBeCloseTo(12, 0);
    expect(metrics.content.marginRight, `${label}: content right margin`).toBeCloseTo(12, 0);
    expect(metrics.details.overflow, `${label}: rounded clipping`).toBe("hidden");

    expect(
      Math.abs(metrics.summary.left - (metrics.details.left + metrics.details.borderLeft)),
      `${label}: summary left boundary`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(metrics.summary.right - (metrics.details.right - metrics.details.borderRight)),
      `${label}: summary right boundary`,
    ).toBeLessThanOrEqual(2);

    const hoverBackgroundAt = async (positionX) => {
      await summary.hover({ position: { x: positionX, y: metrics.summary.height / 2 } });
      return summary.evaluate((element) => ({
        backgroundColor: getComputedStyle(element).backgroundColor,
        isHovered: element.matches(":hover"),
      }));
    };
    const leftHoverBackground = await hoverBackgroundAt(1);
    const rightHoverBackground = await hoverBackgroundAt(
      metrics.summary.right - metrics.summary.left - 1,
    );
    expect(leftHoverBackground.isHovered, `${label}: left edge is inside summary`).toBeTruthy();
    expect(rightHoverBackground.isHovered, `${label}: right edge is inside summary`).toBeTruthy();
    expect(leftHoverBackground.backgroundColor, `${label}: left edge hover background`).not.toBe(
      metrics.summary.backgroundColor,
    );
    expect(rightHoverBackground.backgroundColor, `${label}: right edge hover background`).not.toBe(
      metrics.summary.backgroundColor,
    );
  };

  const guidedSurfaces = [
    ["QuickCheck Hint", firstQuickCheck.locator("details.rensyuHint")],
    ["QuickCheck Answer", firstQuickCheck.locator("details.rensyuKaitou")],
    ["Exercise Hint", firstExercise.locator("details.rensyuHint")],
    ["Exercise Answer", firstExercise.locator("details.rensyuKaitou")],
  ];
  for (const [label, details] of guidedSurfaces) {
    await assertHoverSurface(details, label);
  }

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
    return {
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
      outlineOffset: styles.outlineOffset,
    };
  });
  expect(focusStyles.outlineStyle).not.toBe("none");
  expect(focusStyles.outlineWidth).not.toBe("0px");
  expect(focusStyles.outlineOffset).toBe("-2px");
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

  for (const [label, details] of guidedSurfaces) {
    await expect(details, `${label} dark: details starts closed`).not.toHaveAttribute("open", "");
    const summary = details.locator(":scope > summary");
    await summary.focus();
    const darkFocusStyles = await summary.evaluate((element) => {
      const detailsElement = element.parentElement;
      const detailsStyle = detailsElement && getComputedStyle(detailsElement);
      const detailsRect = detailsElement?.getBoundingClientRect();
      const summaryRect = element.getBoundingClientRect();
      const pixels = (value) => Number.parseFloat(value) || 0;
      return {
        outlineStyle: getComputedStyle(element).outlineStyle,
        outlineWidth: getComputedStyle(element).outlineWidth,
        outlineOffset: getComputedStyle(element).outlineOffset,
        detailsOpen: detailsElement?.hasAttribute("open"),
        detailsInnerLeft:
          detailsRect && detailsStyle
            ? detailsRect.left + pixels(detailsStyle.borderLeftWidth)
            : null,
        detailsInnerRight:
          detailsRect && detailsStyle
            ? detailsRect.right - pixels(detailsStyle.borderRightWidth)
            : null,
        summaryLeft: summaryRect.left,
        summaryRight: summaryRect.right,
      };
    });
    expect(darkFocusStyles.outlineStyle, `${label} dark: focus outline style`).not.toBe("none");
    expect(darkFocusStyles.outlineWidth, `${label} dark: focus outline width`).not.toBe("0px");
    expect(darkFocusStyles.outlineOffset, `${label} dark: focus outline offset`).toBe("-2px");
    expect(darkFocusStyles.detailsOpen, `${label} dark: focus does not open details`).toBeFalsy();
    expect(
      Math.abs(darkFocusStyles.summaryLeft - darkFocusStyles.detailsInnerLeft),
      `${label} dark: summary left inner boundary`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(darkFocusStyles.summaryRight - darkFocusStyles.detailsInnerRight),
      `${label} dark: summary right inner boundary`,
    ).toBeLessThanOrEqual(2);
  }

  for (const [label, details] of guidedSurfaces) {
    await assertHoverSurface(details, `${label} dark`);
  }

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.locator("#metyatech-exercise-style")).toHaveCount(1);
  for (const [label, details] of guidedSurfaces) {
    await assertHoverSurface(details, `${label} 375px`);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBeTruthy();

  const lineNumbers = page.getByRole("button", { name: "行番号を表示" }).first();
  await lineNumbers.click();
  await expect(page.getByRole("button", { name: "行番号を隠す" }).first()).toBeVisible();
});

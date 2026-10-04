const { expect, test } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { suiteConfig } = require("./suite-config.cjs");
const { resolveCourseKey } = require("./course-defaults.cjs");

const THEMES = ["light", "dark"];
const INTERACTIVE_SELECTOR = 'main a, main button, main [role="button"], header a, header button';
const BOUNDARY_SELECTOR = "body *";
const MAX_ELEMENTS_PER_PAGE = 5;
const MIN_BACKGROUND_CONTRAST = 1.1;
const MIN_BORDER_CONTRAST = 3;
const MIN_BOUNDARY_AREA = 600;
const MAX_BOUNDARY_ISSUES_PER_PAGE = 120;
// const MAX_DISCOVERED_PATHS = 4; // Removed to run all paths
const HOST = process.env.E2E_HOST ?? "localhost";
const PORT_FROM_ENV = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 3101;
const PORT = Number.isFinite(PORT_FROM_ENV) ? PORT_FROM_ENV : 3101;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://${HOST}:${PORT}`;

function extractPathsFromSitemap(xmlText) {
  const matches = [...xmlText.matchAll(/<loc>(.*?)<\/loc>/g)];
  return [...new Set(matches.map((match) => new URL(match[1]).pathname))];
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/") {
    return "/";
  }
  const withoutHash = pathname.split("#")[0];
  return withoutHash.endsWith("/") ? withoutHash : `${withoutHash}/`;
}

async function setThemeAndOpen(page, path, theme) {
  await page.addInitScript((currentTheme) => {
    localStorage.setItem("theme", currentTheme);
    localStorage.setItem("vitepress-theme-appearance", currentTheme);
  }, theme);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector("main", { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function runAxeContrastCheck(
  page,
  includeSelector,
  excludeSelector,
  globalExclude,
  filterNextraUi = true,
) {
  const builder = new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .options({ iframes: false });

  if (includeSelector) {
    builder.include(includeSelector);
  }

  const explicitExcludes = excludeSelector
    ? Array.isArray(excludeSelector)
      ? excludeSelector
      : [excludeSelector]
    : [];
  for (const selector of [...explicitExcludes, ...globalExclude]) {
    builder.exclude(selector);
  }

  const result = await builder.analyze();
  result.violations = result.violations.filter((violation) => {
    if (violation.id !== "color-contrast") {
      return false;
    }
    violation.nodes = violation.nodes.filter((node) => {
      const target = Array.isArray(node.target) ? node.target.join(" ") : String(node.target);
      const targetLower = target.toLowerCase();
      const isIframe = target.includes("|") || targetLower.includes("iframe");
      const isNonContentUi =
        targetLower.includes("styles-module") ||
        targetLower.includes("monaco-editor") ||
        (filterNextraUi && targetLower.includes("nextra-"));
      return !isIframe && !isNonContentUi;
    });
    return violation.nodes.length > 0;
  });

  return result;
}

const NON_CONTENT_UI_EXCLUDES = ["iframe", '[class*="styles-module"]', ".monaco-editor"];

async function runGeneralUiContrastCheck(page, includeSelector, excludeSelector) {
  return await runAxeContrastCheck(page, includeSelector, excludeSelector, [
    ...NON_CONTENT_UI_EXCLUDES,
    ".nextra-code",
    "pre",
    "code",
    "[data-highlighted-line]",
    '[class*="nextra-"]',
  ]);
}

async function runCodeContrastCheck(page, includeSelector) {
  if ((await page.locator(includeSelector).count()) === 0) {
    return { violations: [] };
  }
  return runAxeContrastCheck(page, includeSelector, undefined, NON_CONTENT_UI_EXCLUDES, false);
}

async function collectCodeHighlightVisibilityIssues(page, path, theme, includeSelector) {
  return await page.evaluate(
    ({ path, theme, includeSelector }) => {
      const readColor = (value) => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1].split(",").map((part) => Number(part.trim()));
        return {
          red: parts[0],
          green: parts[1],
          blue: parts[2],
          alpha: parts.length > 3 ? parts[3] : 1,
        };
      };
      const colorText = (color) =>
        color ? `rgb(${color.red}, ${color.green}, ${color.blue})` : "unknown";
      const isTransparent = (color) => !color || color.alpha === 0;
      const sameColor = (first, second) =>
        first &&
        second &&
        first.red === second.red &&
        first.green === second.green &&
        first.blue === second.blue;
      const toLinear = (channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const toOklab = (color) => {
        const red = toLinear(color.red);
        const green = toLinear(color.green);
        const blue = toLinear(color.blue);
        const lightness = Math.cbrt(
          0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
        );
        const greenAxis = Math.cbrt(
          0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
        );
        const blueAxis = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
        return [
          0.2104542553 * lightness + 0.793617785 * greenAxis - 0.0040720468 * blueAxis,
          1.9779984951 * lightness - 2.428592205 * greenAxis + 0.4505937099 * blueAxis,
          0.0259040371 * lightness + 0.7827717662 * greenAxis - 0.808675766 * blueAxis,
        ];
      };
      const perceptualDistance = (first, second) => {
        const firstLab = toOklab(first);
        const secondLab = toOklab(second);
        return Math.hypot(...firstLab.map((channel, index) => channel - secondLab[index]));
      };
      const contrastRatio = (first, second) => {
        const luminance = (color) =>
          0.2126 * toLinear(color.red) +
          0.7152 * toLinear(color.green) +
          0.0722 * toLinear(color.blue);
        const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
        return (lighter + 0.05) / (darker + 0.05);
      };
      const visibleBackground = (element) => {
        for (
          let current = element;
          current instanceof HTMLElement;
          current = current.parentElement
        ) {
          const color = readColor(window.getComputedStyle(current).backgroundColor);
          if (!isTransparent(color)) return color;
        }
        return null;
      };

      const highlightedLines = [
        ...document.querySelectorAll(`${includeSelector} > span[data-highlighted-line]`),
      ];
      const issues = [];

      for (const line of highlightedLines) {
        const code = line.closest("code.nextra-code");
        const pre = line.closest("pre");
        const normalLine = [...(code?.children ?? [])].find(
          (child) => child instanceof HTMLElement && !child.hasAttribute("data-highlighted-line"),
        );
        const highlightBackground = readColor(window.getComputedStyle(line).backgroundColor);
        const normalBackground = normalLine
          ? visibleBackground(normalLine)
          : visibleBackground(code);
        const preBackground = visibleBackground(pre);
        const backgroundDistance =
          highlightBackground && normalBackground
            ? perceptualDistance(highlightBackground, normalBackground)
            : 0;
        const boxShadow = window.getComputedStyle(line).boxShadow;
        const hasLeftCue =
          boxShadow !== "none" &&
          boxShadow.includes("inset") &&
          /4px\s+0(?:px)?\b/u.test(boxShadow);

        if (isTransparent(highlightBackground) || highlightBackground.alpha < 1) {
          issues.push({
            path,
            theme,
            reason: "highlight background is transparent or translucent",
          });
        } else if (
          sameColor(highlightBackground, normalBackground) ||
          sameColor(highlightBackground, preBackground)
        ) {
          issues.push({
            path,
            theme,
            reason: `highlight background ${colorText(highlightBackground)} matches ordinary code background`,
          });
        } else if (backgroundDistance < 0.035) {
          // Repo-specific visibility contract: the intended light/dark fills measure >= 0.039
          // in OKLab, while the previous dark fill measured 0.027. This rejects near-identical
          // fills without treating background distinction as a WCAG contrast requirement.
          issues.push({
            path,
            theme,
            reason: `highlight background is too close to ordinary code background (OKLab Δ ${backgroundDistance.toFixed(3)})`,
          });
        }

        if (!hasLeftCue) {
          issues.push({
            path,
            theme,
            reason: `highlight line has no 4px inset left cue (${boxShadow})`,
          });
        }
      }

      return issues;
    },
    { path, theme, includeSelector },
  );
}

async function collectShikiHighlightTokenIssues(page, path, theme, includeSelector) {
  return await page.evaluate(
    ({ path, theme, includeSelector }) => {
      const issues = [];
      const colorProbe = document.createElement("span");
      document.body.append(colorProbe);

      const normalizeColor = (value) => {
        colorProbe.style.color = "";
        colorProbe.style.color = value;
        if (!colorProbe.style.color) return null;
        return window.getComputedStyle(colorProbe).color;
      };
      const parseColor = (value) => {
        const match = value?.match(/rgba?\(([^)]+)\)/u);
        if (!match) return null;
        const channels = match[1]
          .split(/[, ]+|\s+\/\s+/u)
          .filter(Boolean)
          .map(Number);
        if (channels.length < 3 || channels.slice(0, 3).some(Number.isNaN)) return null;
        return { red: channels[0], green: channels[1], blue: channels[2] };
      };
      const linearize = (channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color) =>
        0.2126 * linearize(color.red) +
        0.7152 * linearize(color.green) +
        0.0722 * linearize(color.blue);
      const contrastRatio = (foreground, background) => {
        const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
          (a, b) => b - a,
        );
        return (lighter + 0.05) / (darker + 0.05);
      };
      const shikiProperty = theme === "dark" ? "--shiki-dark" : "--shiki-light";
      const lines = [
        ...document.querySelectorAll(`${includeSelector} > span[data-highlighted-line]`),
      ];
      const seenColors = new Set();
      const contrastRatios = [];
      let tokenCount = 0;

      for (const line of lines) {
        const background = parseColor(window.getComputedStyle(line).backgroundColor);
        for (const token of line.querySelectorAll("span")) {
          const declaredColor = window
            .getComputedStyle(token)
            .getPropertyValue(shikiProperty)
            .trim();
          if (!declaredColor) continue;
          tokenCount += 1;
          const expectedColor = normalizeColor(declaredColor);
          const computedColor = window.getComputedStyle(token).color;
          const tokenLabel = `${token.tagName.toLowerCase()}${token.className ? `.${String(token.className).trim().replace(/\s+/gu, ".")}` : ""}`;
          const expected = parseColor(expectedColor);
          const computed = parseColor(computedColor);
          if (!expectedColor || expectedColor !== computedColor) {
            issues.push({
              path,
              theme,
              token: tokenLabel,
              reason: `${shikiProperty} ${declaredColor} normalizes to ${expectedColor}; computed color is ${computedColor}`,
            });
            continue;
          }
          seenColors.add(expectedColor);
          if (!expected || !background) {
            issues.push({
              path,
              theme,
              token: tokenLabel,
              reason: "unable to parse token or highlight color",
            });
            continue;
          }
          const ratio = contrastRatio(expected, background);
          contrastRatios.push(ratio);
          if (ratio < 4.5) {
            issues.push({
              path,
              theme,
              token: tokenLabel,
              sample: token.textContent.trim().slice(0, 48),
              reason: `${shikiProperty} ${declaredColor} has ${ratio.toFixed(2)}:1 contrast against ${window.getComputedStyle(line).backgroundColor}`,
            });
          }
        }
      }

      colorProbe.remove();
      if (tokenCount === 0) {
        issues.push({ path, theme, reason: `no highlighted tokens expose ${shikiProperty}` });
      } else if (seenColors.size < 2) {
        issues.push({
          path,
          theme,
          reason: `expected multiple Shiki syntax colors, found ${seenColors.size}`,
        });
      }
      return {
        issues,
        tokenCount,
        uniqueShikiColors: seenColors.size,
        minimumContrast: contrastRatios.length ? Math.min(...contrastRatios) : null,
      };
    },
    { path, theme, includeSelector },
  );
}

async function collectBoundaryIssues(page, path, theme, selector = BOUNDARY_SELECTOR) {
  const issues = await page.evaluate(
    ({
      selector,
      minBackgroundContrast,
      minBorderContrast,
      minBoundaryArea,
      maxBoundaryIssuesPerPage,
    }) => {
      const candidates = [...document.querySelectorAll(selector)].filter(
        (node) => node instanceof HTMLElement,
      );
      const colorProbe = document.createElement("span");

      const parseColor = (colorText) => {
        if (!colorText) {
          return null;
        }
        colorProbe.style.color = "";
        colorProbe.style.color = colorText;
        const normalized = colorProbe.style.color || colorText;
        if (normalized === "transparent") {
          return { red: 0, green: 0, blue: 0, alpha: 0 };
        }

        const match = normalized.match(/rgba?\(([^)]+)\)/);
        if (!match) {
          return null;
        }
        const parts = match[1].split(",").map((part) => part.trim());
        if (parts.length < 3) {
          return null;
        }
        const red = Number(parts[0]);
        const green = Number(parts[1]);
        const blue = Number(parts[2]);
        const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
        if ([red, green, blue, alpha].some(Number.isNaN)) {
          return null;
        }
        return { red, green, blue, alpha };
      };

      const extractColorTokens = (text) => {
        if (!text || text === "none") {
          return [];
        }
        const tokenPattern = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|transparent/g;
        return text.match(tokenPattern) || [];
      };

      const parseColorList = (tokens) =>
        tokens.map((token) => parseColor(token)).filter((color) => color && color.alpha > 0);

      const averageColors = (colors) => {
        if (!colors.length) {
          return null;
        }
        let weightTotal = 0;
        let redTotal = 0;
        let greenTotal = 0;
        let blueTotal = 0;
        let alphaTotal = 0;
        for (const color of colors) {
          const weight = Math.max(color.alpha, 0.05);
          weightTotal += weight;
          redTotal += color.red * weight;
          greenTotal += color.green * weight;
          blueTotal += color.blue * weight;
          alphaTotal += color.alpha;
        }
        return {
          red: redTotal / weightTotal,
          green: greenTotal / weightTotal,
          blue: blueTotal / weightTotal,
          alpha: Math.min(1, alphaTotal / colors.length),
        };
      };

      const blendColor = (foreground, background) => {
        const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
        if (alpha <= 0) {
          return { red: 0, green: 0, blue: 0, alpha: 0 };
        }
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

      const toLinear = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };

      const luminance = (color) =>
        0.2126 * toLinear(color.red) +
        0.7152 * toLinear(color.green) +
        0.0722 * toLinear(color.blue);

      const contrast = (first, second) => {
        const bright = luminance(first);
        const dark = luminance(second);
        const [maxLum, minLum] = bright >= dark ? [bright, dark] : [dark, bright];
        return (maxLum + 0.05) / (minLum + 0.05);
      };

      const resolveBaseColor = () => {
        const htmlColor = parseColor(
          window.getComputedStyle(document.documentElement).backgroundColor,
        );
        if (htmlColor && htmlColor.alpha > 0) {
          return htmlColor;
        }
        const bodyColor = parseColor(window.getComputedStyle(document.body).backgroundColor);
        if (bodyColor && bodyColor.alpha > 0) {
          return bodyColor;
        }
        return document.documentElement.classList.contains("dark")
          ? { red: 9, green: 17, blue: 32, alpha: 1 }
          : { red: 255, green: 255, blue: 255, alpha: 1 };
      };

      const resolveRepresentativeBackgroundColor = (style) => {
        const colors = [];
        const solid = parseColor(style.backgroundColor);
        if (solid && solid.alpha > 0) {
          colors.push(solid);
        }
        const gradientColors = parseColorList(extractColorTokens(style.backgroundImage));
        colors.push(...gradientColors);
        return averageColors(colors);
      };

      const resolveEdgeCue = (style) => {
        const edgeColors = [];
        const borderSides = [
          {
            width: Number.parseFloat(style.borderTopWidth) || 0,
            style: style.borderTopStyle,
            color: parseColor(style.borderTopColor),
          },
          {
            width: Number.parseFloat(style.borderRightWidth) || 0,
            style: style.borderRightStyle,
            color: parseColor(style.borderRightColor),
          },
          {
            width: Number.parseFloat(style.borderBottomWidth) || 0,
            style: style.borderBottomStyle,
            color: parseColor(style.borderBottomColor),
          },
          {
            width: Number.parseFloat(style.borderLeftWidth) || 0,
            style: style.borderLeftStyle,
            color: parseColor(style.borderLeftColor),
          },
        ];

        let visibleBorderSides = 0;
        for (const border of borderSides) {
          if (border.width <= 0 || border.style === "none") {
            continue;
          }
          if (border.color && border.color.alpha > 0) {
            visibleBorderSides += 1;
            edgeColors.push(border.color);
          }
        }

        let hasOutlineCue = false;
        const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
        if (outlineWidth > 0 && style.outlineStyle !== "none") {
          const outlineColor = parseColor(style.outlineColor);
          if (outlineColor && outlineColor.alpha > 0) {
            hasOutlineCue = true;
            edgeColors.push(outlineColor);
          }
        }

        const shadowColors = parseColorList(extractColorTokens(style.boxShadow));
        edgeColors.push(...shadowColors);
        return {
          edgeColors,
          hasContainerEdgeCue: visibleBorderSides >= 2 || hasOutlineCue || shadowColors.length > 0,
        };
      };

      const hasRoundedCorner = (style) => {
        const radii = [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ].map((value) => Number.parseFloat(value) || 0);
        return Math.max(...radii) >= 3;
      };

      const resolveEffectiveBackgroundColor = (node) => {
        let current = node;
        let output = resolveBaseColor();
        const chain = [];
        while (current) {
          chain.unshift(current);
          current = current.parentElement;
        }

        for (const chainNode of chain) {
          const style = window.getComputedStyle(chainNode);
          const backgroundColor = parseColor(style.backgroundColor);
          if (!backgroundColor) {
            continue;
          }
          output = blendColor(backgroundColor, output);
        }
        return output;
      };

      const results = [];
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width * rect.height < minBoundaryArea) {
          continue;
        }

        const candidateStyle = window.getComputedStyle(candidate);
        if (
          candidateStyle.display === "none" ||
          candidateStyle.visibility !== "visible" ||
          Number.parseFloat(candidateStyle.opacity) < 0.05
        ) {
          continue;
        }

        const candidateTagName = candidate.tagName.toLowerCase();
        const candidateClassName = String(candidate.className || "");
        const isNextDevToolsButton =
          candidateTagName === "button" &&
          (candidate.id === "next-logo" || candidate.hasAttribute("data-nextjs-dev-tools-button"));
        const isLineHighlight = candidateClassName.includes("current-line");
        const isProseList =
          (candidateTagName === "ul" || candidateTagName === "ol") &&
          (candidateClassName.includes("x:list-disc") ||
            candidateClassName.includes("x:list-decimal") ||
            candidateClassName.includes("x:list-none"));
        if (isNextDevToolsButton || isLineHighlight || isProseList) {
          continue;
        }

        const parent = candidate.parentElement;
        if (!parent) {
          continue;
        }

        const parentBackgroundColor = resolveEffectiveBackgroundColor(parent);
        const backgroundCueColor = resolveRepresentativeBackgroundColor(candidateStyle);
        const edgeCue = resolveEdgeCue(candidateStyle);
        const edgeCueColors = edgeCue.edgeColors;
        const hasBackgroundCue = Boolean(backgroundCueColor);
        const hasEdgeCue = edgeCueColors.length > 0;
        const hasContainerEdgeCue = edgeCue.hasContainerEdgeCue;

        if (!hasBackgroundCue && !hasEdgeCue) {
          continue;
        }

        if (!hasBackgroundCue && hasEdgeCue && !hasContainerEdgeCue) {
          continue;
        }

        const roundedCorner = hasRoundedCorner(candidateStyle);
        if (!hasEdgeCue && !roundedCorner) {
          continue;
        }

        let backgroundContrast = 0;
        if (hasBackgroundCue) {
          const candidateBackground = blendColor(backgroundCueColor, parentBackgroundColor);
          backgroundContrast = contrast(candidateBackground, parentBackgroundColor);
        }

        let borderContrast = 0;
        if (hasEdgeCue) {
          const contrasts = edgeCueColors.map((edgeColor) => {
            const candidateEdge = blendColor(edgeColor, parentBackgroundColor);
            return contrast(candidateEdge, parentBackgroundColor);
          });
          borderContrast = Math.max(...contrasts);
        }

        const passesBoundaryContrast =
          (hasBackgroundCue && backgroundContrast >= minBackgroundContrast) ||
          (hasEdgeCue && borderContrast >= minBorderContrast);

        if (!passesBoundaryContrast) {
          results.push({
            tagName: candidateTagName,
            className: candidateClassName,
            backgroundContrast: Number(backgroundContrast.toFixed(2)),
            borderContrast: Number(borderContrast.toFixed(2)),
          });
          if (results.length >= maxBoundaryIssuesPerPage) {
            break;
          }
        }
      }

      return results;
    },
    {
      selector,
      minBackgroundContrast: MIN_BACKGROUND_CONTRAST,
      minBorderContrast: MIN_BORDER_CONTRAST,
      minBoundaryArea: MIN_BOUNDARY_AREA,
      maxBoundaryIssuesPerPage: MAX_BOUNDARY_ISSUES_PER_PAGE,
    },
  );

  return issues.map((issue) => ({
    path,
    theme,
    state: "boundary",
    id: "container-boundary-contrast",
    description: `tag=${issue.tagName} class=${issue.className} bg=${issue.backgroundContrast} border=${issue.borderContrast}`,
  }));
}

async function collectStateIssues(page, path, theme) {
  const formatViolation = (violation) => {
    const targets = violation.nodes
      .flatMap((node) => node.target || [])
      .slice(0, 3)
      .join(" | ");
    const targetText = targets ? ` targets: ${targets}` : "";
    return `${violation.description}${targetText}`;
  };

  const issues = [];
  const baseResult = await runGeneralUiContrastCheck(page);
  for (const violation of baseResult.violations) {
    issues.push({
      path,
      theme,
      state: "default",
      id: violation.id,
      description: formatViolation(violation),
    });
  }

  const candidates = page.locator(INTERACTIVE_SELECTOR);
  const count = Math.min(await candidates.count(), MAX_ELEMENTS_PER_PAGE);
  for (let index = 0; index < count; index += 1) {
    const element = candidates.nth(index);
    if (!(await element.isVisible())) {
      continue;
    }
    const markerName = "data-contrast-target";
    await element.evaluate((node, attrName) => node.setAttribute(attrName, "1"), markerName);
    try {
      await element.hover({ force: true });
      await page.waitForTimeout(80);
      const hoverResult = await runGeneralUiContrastCheck(page, `[${markerName}="1"]`);
      for (const violation of hoverResult.violations) {
        issues.push({
          path,
          theme,
          state: "hover",
          id: violation.id,
          description: formatViolation(violation),
        });
      }

      await element.focus();
      await page.waitForTimeout(80);
      const focusResult = await runGeneralUiContrastCheck(page, `[${markerName}="1"]`);
      for (const violation of focusResult.violations) {
        issues.push({
          path,
          theme,
          state: "focus",
          id: violation.id,
          description: formatViolation(violation),
        });
      }
    } finally {
      await element.evaluate((node, attrName) => node.removeAttribute(attrName), markerName);
    }
  }

  return issues;
}

function formatIssues(issues) {
  return issues
    .map(
      (issue) => `${issue.theme} ${issue.path} [${issue.state}] ${issue.id}: ${issue.description}`,
    )
    .join("\n");
}

test.describe("Core routes contrast", () => {
  // test.describe.configure({ mode: "parallel" });

  const seedPaths = ["/", normalizePath(suiteConfig.docsIntroPath)];
  if (suiteConfig.enableCodePreview) {
    seedPaths.push(normalizePath(suiteConfig.codePreviewPath));
  }
  const uniqueSeedPaths = [...new Set(seedPaths)];
  const coreTargetPaths = uniqueSeedPaths;

  for (const theme of THEMES) {
    for (const path of coreTargetPaths) {
      test(`color and boundary contrast are valid on ${path} (${theme} mode)`, async ({
        browser,
      }) => {
        test.setTimeout(180_000);
        const allIssues = [];
        const context = await browser.newContext({
          baseURL: BASE_URL,
          colorScheme: theme,
        });

        try {
          const page = await context.newPage();
          try {
            const loaded = await setThemeAndOpen(page, path, theme);
            if (loaded) {
              const stateIssues = await collectStateIssues(page, path, theme);
              const boundaryIssues = await collectBoundaryIssues(page, path, theme);
              allIssues.push(...stateIssues);
              allIssues.push(...boundaryIssues);
            }
          } finally {
            await page.close();
          }
        } finally {
          await context.close();
        }

        expect(allIssues, formatIssues(allIssues)).toEqual([]);
      });
    }
  }
});

const exerciseTargetPaths = suiteConfig.exerciseContrastPaths.map(normalizePath);

if (exerciseTargetPaths.length === 0) {
  test("Exercise color and boundary contrast are valid on configured routes", () => {
    test.skip(true, "No Exercise contrast routes are configured for this course");
  });
} else {
  test.describe("Exercise contrast", () => {
    // test.describe.configure({ mode: "parallel" });

    for (const theme of THEMES) {
      for (const path of exerciseTargetPaths) {
        test(`Exercise color and boundary contrast are valid on ${path} (${theme} mode)`, async ({
          browser,
        }) => {
          test.setTimeout(180_000);
          const allIssues = [];
          const context = await browser.newContext({
            baseURL: BASE_URL,
            colorScheme: theme,
          });

          try {
            const page = await context.newPage();
            try {
              const loaded = await setThemeAndOpen(page, path, theme);
              if (loaded) {
                const exerciseBlocks = await page.locator(".rensyuBlock").count();
                expect(exerciseBlocks, `${path} must contain Exercise blocks`).toBeGreaterThan(0);

                const summaries = page.locator(".rensyuBlock summary");
                const summaryCount = await summaries.count();
                for (let index = 0; index < summaryCount; index += 1) {
                  const summary = summaries.nth(index);
                  if (await summary.isVisible()) {
                    await summary.click();
                  }
                }

                let axeResult;
                try {
                  axeResult = await runGeneralUiContrastCheck(page, ".rensyuBlock");
                } catch (error) {
                  if (!String(error?.message ?? error).includes("No elements found for include")) {
                    throw error;
                  }
                  axeResult = { violations: [] };
                }
                for (const violation of axeResult.violations) {
                  allIssues.push({
                    path,
                    theme,
                    state: "exercise",
                    id: violation.id,
                    description: violation.nodes
                      .flatMap((node) => node.target || [])
                      .slice(0, 3)
                      .join(" | "),
                  });
                }

                const boundaryIssues = await collectBoundaryIssues(
                  page,
                  path,
                  theme,
                  ".rensyuBlock, .rensyuBlock *",
                );
                allIssues.push(...boundaryIssues);

                const codeSelector = ".rensyuBlock pre code.nextra-code";
                if (
                  resolveCourseKey(process.env.COURSE_CONTENT_SOURCE) ===
                    "javascript-course-docs" &&
                  path === "/docs/basics/dom-css/"
                ) {
                  expect(
                    await page
                      .locator(
                        ".rensyuBlock pre code.nextra-code > span:not([data-highlighted-line])",
                      )
                      .count(),
                    "the JavaScript DOM/CSS exercise route must contain normal code lines",
                  ).toBeGreaterThan(0);
                  expect(
                    await page
                      .locator(".rensyuBlock pre code.nextra-code > span[data-highlighted-line]")
                      .count(),
                    "the JavaScript DOM/CSS exercise route must contain highlighted code lines",
                  ).toBeGreaterThan(0);
                }

                const codeResult = await runCodeContrastCheck(page, codeSelector);
                for (const violation of codeResult.violations) {
                  allIssues.push({
                    path,
                    theme,
                    state: "code",
                    id: violation.id,
                    description: violation.nodes
                      .flatMap((node) => node.target || [])
                      .slice(0, 3)
                      .join(" | "),
                  });
                }
              }
            } finally {
              await page.close();
            }
          } finally {
            await context.close();
          }

          expect(allIssues, formatIssues(allIssues)).toEqual([]);
        });
      }
    }

    test.describe("Code highlight visibility", () => {
      for (const theme of THEMES) {
        for (const path of exerciseTargetPaths) {
          test(`highlighted lines are distinct from normal code on ${path} (${theme} mode)`, async ({
            browser,
          }) => {
            const context = await browser.newContext({ baseURL: BASE_URL, colorScheme: theme });
            try {
              const page = await context.newPage();
              try {
                const loaded = await setThemeAndOpen(page, path, theme);
                test.skip(!loaded, `Unable to open ${path}`);

                const codeSelector = ".rensyuBlock pre code.nextra-code";
                const normalLineCount = await page
                  .locator(`${codeSelector} > span:not([data-highlighted-line])`)
                  .count();
                const highlightedLineCount = await page
                  .locator(`${codeSelector} > span[data-highlighted-line]`)
                  .count();

                if (
                  resolveCourseKey(process.env.COURSE_CONTENT_SOURCE) ===
                    "javascript-course-docs" &&
                  path === "/docs/basics/dom-css/"
                ) {
                  expect(normalLineCount, `${path} must contain normal code lines`).toBeGreaterThan(
                    0,
                  );
                  expect(
                    highlightedLineCount,
                    `${path} must contain highlighted code lines`,
                  ).toBeGreaterThan(0);
                }

                const issues = await collectCodeHighlightVisibilityIssues(
                  page,
                  path,
                  theme,
                  codeSelector,
                );
                expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
              } finally {
                await page.close();
              }
            } finally {
              await context.close();
            }
          });
        }
      }

      if (
        resolveCourseKey(process.env.COURSE_CONTENT_SOURCE) === "javascript-course-docs" &&
        exerciseTargetPaths.includes("/docs/basics/dom-css/")
      ) {
        for (const theme of THEMES) {
          test(`highlighted Shiki colors are preserved with AA contrast (${theme} mode)`, async ({
            browser,
          }) => {
            const path = "/docs/basics/dom-css/";
            const context = await browser.newContext({ baseURL: BASE_URL, colorScheme: theme });
            try {
              const page = await context.newPage();
              try {
                const loaded = await setThemeAndOpen(page, path, theme);
                test.skip(!loaded, `Unable to open ${path}`);

                const tokenResult = await collectShikiHighlightTokenIssues(
                  page,
                  path,
                  theme,
                  ".rensyuBlock pre code.nextra-code",
                );
                expect(tokenResult.issues, JSON.stringify(tokenResult.issues, null, 2)).toEqual([]);
                expect(tokenResult.tokenCount).toBeGreaterThan(0);
                expect(tokenResult.uniqueShikiColors).toBeGreaterThanOrEqual(2);
                expect(tokenResult.minimumContrast).toBeGreaterThanOrEqual(4.5);
              } finally {
                await page.close();
              }
            } finally {
              await context.close();
            }
          });
        }
      }
    });
  });
}

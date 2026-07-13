import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(projectRoot, 'styles', 'course-site.css');

const extractRuleBody = (source, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\}`));
  assert.ok(match?.groups?.body, `Expected CSS rule for ${selector}`);
  return match.groups.body;
};

const declarationsFrom = (body) =>
  Object.fromEntries(
    [
      ...body.matchAll(
        /(?<property>--?[a-z0-9-]+)\s*:\s*(?<value>#[0-9a-f]{6}|var\(--[a-z0-9-]+\)|transparent)\s*;/gi,
      ),
    ].map(({ groups }) => [groups.property, groups.value]),
  );

const parseHexColor = (value) => {
  const match = value.match(/^#(?<red>[0-9a-f]{2})(?<green>[0-9a-f]{2})(?<blue>[0-9a-f]{2})$/i);
  assert.ok(match?.groups, `Expected a 6-digit hex color, got ${value}`);
  return ['red', 'green', 'blue'].map(
    (channel) => Number.parseInt(match.groups[channel], 16) / 255,
  );
};

const linearize = (channel) =>
  channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const luminance = (hexColor) => {
  const [red, green, blue] = parseHexColor(hexColor).map(linearize);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (firstColor, secondColor) => {
  const [lighter, darker] = [luminance(firstColor), luminance(secondColor)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

const assertContrast = ({ label, foreground, background, minimum }) => {
  const ratio = contrastRatio(foreground, background);
  assert.ok(
    ratio >= minimum,
    `${label} contrast ratio ${ratio.toFixed(2)} must be at least ${minimum}:1`,
  );
};

test('Exercise dark-mode colors meet WCAG contrast thresholds', async () => {
  const css = await fs.readFile(cssPath, 'utf8');
  const exerciseRule = declarationsFrom(extractRuleBody(css, '.dark .rensyuBlock'));

  const colors = {
    surface: exerciseRule['--course-exercise-dark-surface'],
    surfaceMuted: exerciseRule['--course-exercise-dark-surface-muted'],
    text: exerciseRule['--course-exercise-dark-text'],
    textMuted: exerciseRule['--course-exercise-dark-text-muted'],
    border: exerciseRule['--course-exercise-dark-border'],
    divider: exerciseRule['--course-exercise-dark-divider'],
    accent: exerciseRule['--course-exercise-dark-accent'],
    focus: exerciseRule['--course-exercise-dark-focus'],
  };

  for (const [name, value] of Object.entries(colors)) {
    assert.match(value, /^#[0-9a-f]{6}$/i, `${name} must be declared as a hex color`);
  }

  [
    { label: 'Exercise body text', foreground: colors.text, background: colors.surface },
    { label: 'Exercise muted text', foreground: colors.textMuted, background: colors.surface },
    { label: 'Exercise inline link text', foreground: colors.accent, background: colors.surface },
    { label: 'Exercise code text', foreground: colors.text, background: colors.surfaceMuted },
  ].forEach((pair) => assertContrast({ ...pair, minimum: 4.5 }));

  [
    { label: 'Exercise outer border', foreground: colors.border, background: colors.surface },
    { label: 'Exercise internal divider', foreground: colors.divider, background: colors.surface },
    {
      label: 'Exercise blank/input border',
      foreground: colors.border,
      background: colors.surfaceMuted,
    },
    { label: 'Exercise focus outline', foreground: colors.focus, background: colors.surface },
  ].forEach((pair) => assertContrast({ ...pair, minimum: 3 }));
});

test('Exercise dark-mode CSS covers readable text, solutions, blanks, and focus states', async () => {
  const css = await fs.readFile(cssPath, 'utf8');
  const compactCss = css.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

  assert.match(
    compactCss,
    /\.dark \.rensyuBlock :where\(\.rensyuNaiyou, \.rensyuKaitou, p, li, dd, dt, h1, h2, h3, h4, h5, h6, strong, em, span, div\):not\(\.monaco-editor\):not\(\.monaco-editor \*\)/,
  );
  assert.doesNotMatch(
    compactCss,
    /\.dark \.rensyuBlock :where\(\.rensyuNaiyou, \.rensyuKaitou, p, li, dd, dt, h1, h2, h3, h4, h5, h6, strong, em, span, div\) \{/,
  );
  assert.match(compactCss, /\.dark \.rensyuBlock :where\(code, kbd, samp\)/);
  assert.match(compactCss, /\.dark \.rensyuBlock :where\(pre\)/);
  assert.match(compactCss, /\.dark \.rensyuBlock :where\(\.rensyuKaitou, details, summary\)/);
  assert.match(
    compactCss,
    /\.dark \.rensyuBlock :where\(input, textarea, select, \.rensyuBlank, \.rensyuTag\)/,
  );
  assert.match(
    compactCss,
    /\.dark \.rensyuBlock :where\(input, textarea, select, summary, \.rensyuBlank\):focus-visible/,
  );
  assert.match(compactCss, /\.dark \.rensyuBlock :where\(hr, table, th, td\)/);
});

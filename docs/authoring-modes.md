# Authoring modes for Course Docs Site

Course Docs Site supports exactly two page-level authoring modes:

- `tutorial`
- `non-tutorial`

Choose the mode from the page's primary purpose, not from whether a page happens to contain a short procedure block.

## `tutorial`

Use `authoringMode: tutorial` when the page is a learner-facing step-by-step walkthrough.

```mdx
---
title: Student Guide
authoringMode: tutorial
---

<Section title="Step 1" goal="...">
  ...
</Section>
```

Rules:

- A tutorial page must use `<Section>` as the page-level milestone boundary.
- `remarkTutorialLint` runs only on tutorial pages.
- `authoringMode: tutorial` without any `<Section>` fails the MDX build.

## `non-tutorial`

Use `authoringMode: non-tutorial` when the page is primarily reference, overview, memo, troubleshooting, or any other non-walkthrough material.

```mdx
---
title: Setup and Troubleshooting
authoringMode: non-tutorial
---
```

Rules:

- A non-tutorial page must not use `<Section>`.
- Short procedural blocks may still appear inline on non-tutorial pages; that does not change the page mode by itself.
- If a page becomes both a full tutorial and a reference/overview, split it into separate pages instead of inventing a third page type.

## Migration behavior

Existing pages that already use `<Section>` but do not yet declare `authoringMode: tutorial` still run through tutorial lint so older course content does not silently lose checks. The linter emits a migration note until the frontmatter is added.

Pages without `<Section>` and without `authoringMode` continue to behave as non-tutorial pages.

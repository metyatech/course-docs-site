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

### Page-level components

Tutorial pages support two optional page-level components that sit **outside** `<Section>`:

- `<Prerequisites>` — lists what the learner needs before starting. Place it **before** the first `<Section>`. `remarkTutorialLint` emits a warning (`prerequisites-placement`) if it appears after a `<Section>`.
- `<NextSteps>` — lists concrete next actions (other tutorials, docs, exercises) with links. Place it **after** the last `<Section>`. `remarkTutorialLint` emits an advisory note (`nextsteps-placement`) if it appears before the last `<Section>`.

Both components are optional. Omitting them does not trigger any lint finding.

```mdx
---
title: Student Guide
authoringMode: tutorial
---

<Prerequisites>
  - Unreal Engine 5.4 以上がインストール済みであること - 前回のチュートリアル（Step
  1〜3）を完了していること
</Prerequisites>

<Section title="Step 1" goal="...">
  ...
</Section>

<NextSteps>
  - [次のチュートリアル: アイテム収集](/tutorials/item-pickup) -
  [コリジョン設定リファレンス](/reference/collision)
</NextSteps>
```

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

## Default when omitted

If a page omits `authoringMode`, Course Docs Site treats it as `non-tutorial`.

Rules:

- A page without `authoringMode` and without `<Section>` behaves as a non-tutorial page and skips tutorial lint.
- A page without `authoringMode` that still uses `<Section>` fails the MDX build; add `authoringMode: tutorial` before using tutorial structure.

# Course Docs Site rendering conventions for `markdown-question-spec`

This document describes **optional rendering conventions** used by the Course Docs Site (Nextra/MDX) when displaying questions written in the **plain Markdown** format defined by the `markdown-to-qti` repository (`docs/markdown-question-spec.md`).

These conventions:

- **Do not change** the underlying `markdown-question-spec` format.
- Are applied only by the Course Docs Site renderer (implemented in this repository).
- Keep the source Markdown compatible with Markdown tooling (linters, parsers, schema validation) and with QTI conversion.
- General admonition authoring rules are documented in `docs/admonition-authoring.md`.

## Conventions

## File naming / scope

The Course Docs Site applies these conventions **only** to Markdown files whose filename ends with:

- `.qspec.md`

No specific directory (such as `questions/`) is required. This makes the behavior explicit and avoids transforming unrelated documents that happen to contain similar headings.

### `### Exam` (inside `## Prompt`)

If a question contains the heading `### Exam` under `## Prompt`, the Course Docs Site renders that block as a **Tip-style callout** titled `本試験では`.

Use it to describe “in the real exam…” notes (e.g., identifiers/values will differ).

### `## Scoring`

`## Scoring` is rendered as a **Note-style callout** titled `採点基準・配点`.

The contents remain plain Markdown (typically a bullet list or a table).

### `## Explanation`

`## Explanation` is rendered in the **answer area** of the page (i.e., as the content of `<Solution>` when the question is displayed using the Exercise/Solution UI).

Within `## Explanation`, the following sub-headings are recommended:

- `### 解答` (for the model answer)
- `### 解説` (for a short explanation)

When multiple questions are rendered on the same page, the renderer ensures heading IDs remain unique to avoid client-side key collisions.

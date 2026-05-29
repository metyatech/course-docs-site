<!-- markdownlint-disable MD025 -->
# Tool Rules (compose-agentsmd)

- **Session gate**: before responding to ANY user message, run `compose-agentsmd` from the project root. AGENTS.md contains the rules you operate under; stale rules cause rule violations. If you discover you skipped this step mid-session, stop, run it immediately, re-read the diff, and adjust your behavior before continuing.
- `compose-agentsmd` intentionally regenerates `AGENTS.md`; any resulting `AGENTS.md` diff is expected and must not be treated as an unexpected external change.
- If `compose-agentsmd` is not available, run it via `npx compose-agentsmd`. If `npx` is unavailable or cannot fetch the package, install it via npm with an environment-appropriate method such as `npm install -g compose-agentsmd` when global installs are permitted, or a user-local npm prefix when global installs are not permitted.
- To update shared/global rules, use `compose-agentsmd edit-rules` to locate the writable rules workspace, make changes only in that workspace, then run `compose-agentsmd apply-rules` (do not manually clone or edit the rules source repo outside this workflow).
- If you find an existing clone of the rules source repo elsewhere, do not assume it is the correct rules workspace; always treat `compose-agentsmd edit-rules` output as the source of truth.
- `compose-agentsmd apply-rules` pushes the rules workspace when `source` is GitHub (if the workspace is clean), then regenerates `AGENTS.md` with refreshed rules.
- Do not edit `AGENTS.md` directly; update the source rules and regenerate.
- `tools/tool-rules.md` is the shared rule source for all repositories that use compose-agentsmd.
- Before applying any rule updates, present the planned changes first with an ANSI-colored diff-style preview, ask for explicit approval, then make the edits.
- These tool rules live in tools/tool-rules.md in the compose-agentsmd repository; do not duplicate them in other rule modules.

Source: github:metyatech/agent-rules@HEAD/rules/domains/node/module-system.md

# Node module system (ESM)

- Default to TypeScript (.ts/.tsx); use JavaScript only for tool-required config
  files.
- Always set "type": "module" in package.json.
- Prefer ESM with .js extensions for JavaScript config/scripts (e.g.,
  next.config.js as ESM).

Source: github:metyatech/agent-rules@HEAD/rules/domains/node/npm-packages.md

# Node package publishing

- For scoped npm packages, set publishConfig.access = "public".
- Set files to constrain the published contents.
- If a clean npm install is insufficient, use prepare (or equivalent) to build.

## Verification

- Use npm pack --dry-run to inspect the package contents.
- Run npm test when tests exist.

Source: github:metyatech/agent-rules@HEAD/rules/domains/web/web-ui-and-testing.md

# Web UI and automation

## Browser automation

- For web automation, use the agent-browser Skill.
- If browser launch fails due to missing Playwright binaries, run npx playwright
  install chromium and retry.

## UI verification and E2E

- For user-visible UI changes, verify in a real browser using agent-browser; if
  not possible, explain and provide manual steps.
- Always add E2E tests for user-visible changes; if no harness exists, add one.
- Run E2E in CI and require it for PR merges; do not defer correctness coverage
  to scheduled runs.
- For React UI changes, add tests that cover initial mount and at least one
  update (re-render) path; include unmount/cleanup when relevant.
- If behavior differs between first render and later renders (effects, caching,
  hydration), cover both paths explicitly.
- Configure E2E to fail fast and avoid auto-opening browsers (headless/no-open).
- For Next.js E2E, prefer next build + next start.
- If Playwright tests fail to launch, clear playwright/.cache and retry.
- When adding/changing links, add tests that verify the target resolves; if not
  feasible, document manual verification.
- For cross-system integration flows, add an end-to-end test (or a contract test
  at the boundary). If impractical, document the limitation and get explicit
  user approval before skipping.
- Use established icon libraries; do not handcraft custom icons or inline SVGs.

Source: github:metyatech/agent-rules@HEAD/rules/domains/education/question-authoring.md

# Educational Question Authoring

## Scientific foundations

- Apply Cognitive Load Theory: reduce extraneous load by making prompts
  self-contained, explicit, and free of source-document references.
- Apply retrieval practice and the testing effect: questions should require
  learners to recall, explain, or apply taught knowledge, not merely recognize
  classroom events.
- Apply transfer-appropriate processing: questions should assess concepts,
  procedures, judgments, debugging cues, or misconceptions in reusable contexts.
- Apply formative feedback principles: explanations should help learners repair
  misconceptions at their current level, not merely reveal the answer.

- Educational questions MUST align with the intended learning target, learner
  level, and already-taught scope.
- Each question MUST focus on one concept, skill, judgment, or misconception.
- Prompts MUST be answerable from the question context without relying on
  hidden classroom-event memory.
- Prompts, answers, and explanations MUST stand alone without referring to
  "this material", "the attached document", "lesson N", or other external
  source context unless that source context is included in the prompt itself.
- Questions MUST NOT require untaught or extension-only content unless the task
  explicitly asks for an extension-level assessment.
- Questions MUST have a single defensible answer, or explicitly state the
  accepted answer range.
- Multiple-choice distractors MUST be plausible and based on likely
  misconceptions or mistakes.
- Fill-in questions MUST specify the expected answer format and any forbidden or
  equivalent answers when ambiguity is likely.
- Explanations MUST state the reasoning, concept, procedure, or misconception
  behind the answer.
- Explanations for novice learners MUST be instructional rather than answer-key
  only: include enough reasoning for the learner to repair the misconception.
- When authoring a short question set, order items from lower intrinsic load to
  higher intrinsic load and cover multiple important taught targets rather than
  repeating one surface pattern.

Source: agent-rules-private/rules/course-site-metadata.md

## Course site metadata / sidebar rules

- Define a page title in frontmatter (`title`); do not override titles in `_meta.ts`.
- For grouping-only folders (no `index.mdx`), set the display label in `_meta.ts`.
- Control default sidebar collapse behavior via `theme.config.tsx` sidebar settings (`defaultMenuCollapseLevel`, `autoCollapse`).
  - Use `theme.collapsed` only when an exception is truly necessary.

Source: agent-rules-private/rules/course-site-content-authoring.md

## Course site content authoring (pages / exercises / exams)

This module defines stable, cross-course rules for authoring course content.
Write these rules in a way that keeps learning outcomes (clarity, sequencing, reproducibility) as the top priority.

### Decision priority

- Prefer learning effectiveness over convenience or brevity.
- Write logically precise prose

## Tutorial / hands-on pages

- For step-by-step tutorial pages (hands-on guides, walkthroughs), use the
  `tutorial-authoring` skill. It defines the information hierarchy, component
  system, and writing rules for procedural content.
- Use the `<Section>`, `<Action>`, `<Verify>`, `<Concept>`, `<Reference>`,
  `<Recovery>`, and `<Checkpoint>` components from `course-docs-platform`.
  They are globally available in MDX pages (no import needed).
- `<Section>` is a recursive structural container that replaces both the
  legacy `<Step>` and `<Procedure>`. Nest Sections to any depth instead of
  using a fixed two-level structure. Each top-level Section must declare a
  `goal` prop.
- Do not use `:::note` for background/concept explanations in tutorials; use
  `<Concept>` (which renders as a collapsible `<details>`).
- Do not use `:::caution` as recovery for an Action; use `<Recovery>` placed
  inline immediately after the action that can fail.
- Do not use `---` horizontal rules between sub-sections; only between
  top-level Sections.
- One image per `<Action>`; never batch multiple images before a numbered list.

## Reader perspective and voice

- Write learner-facing pages from the reader's perspective — never open a page
  by describing what the document is, who it targets, or what the lesson covers
  as if writing about the reader from the outside. ("この教材は〜のための資料です"
  や "この授業は〜のための授業です" は典型的な NG 例)
- Address the reader as already present: use second-person direct address
  ("進めましょう", "確認してください") rather than third-person audience
  description ("受講者が操作する", "初学者向け").
- Each page must have a single distinct job. State that job internally before
  writing, and do not duplicate content that belongs to another page's role.

## Prose flow vs. bullet lists

- When explaining WHY a step exists or WHY an ordering was chosen, write prose
  with explicit cause-effect flow ("〜するため、まず〜から始める"). Decomposing
  logical chains into bullets destroys the reasoning thread.
- Reserve bullet lists for genuinely enumerable items (feature lists, key
  bindings, error cases). Do not convert reasoning paragraphs into bullets.

## Page navigation

- Do not add explicit "次へ →" / "次に読む" links for standard sequential
  navigation. Sidebar ordering defines the reading flow; trust it.

## Page content and samples

- Write learner-facing text (body, labels, output strings) in Japanese using beginner-friendly vocabulary.
- Keep prose non-verbose; split longer explanations into short paragraphs, bullet lists, and small headings.
- Do not include editor notes, meta commentary, or policy statements in learner-facing content.
- Keep terminology, heading structure, and explanation granularity consistent with existing pages.
- Keep samples focused: one sample = one topic; split when a sample becomes long.
- Use intention-revealing identifiers; avoid 1-letter variables except `i`/`j`.
- For code that produces output, include expected output inline (e.g. `console.log(x); // 出力: ...`).
- Write comments inside sample code in Japanese.
- Add language info to fenced code blocks (`js`, `ts`, `html`, `css`).
- At the start of a chapter, add 1–2 sentences explaining where/why the topic is used.
- When referencing real websites, do not link to pages that show personal data or require authentication.

## Goal-first ordering

- Before any sequence of steps, always state: (1) what the reader will have built
  or achieved when the sequence is complete, and (2) the meaning of any new
  concept or term that will appear in those steps. Never introduce a term
  (variable name, system name, setting value) in a step before explaining what
  it represents.
- Present the goal as a concrete "what you will build" summary (a short table or
  sentence listing inputs → outputs or before → after states) rather than a
  vague "in this step you will learn…" statement.
- Definitions and goal summaries belong immediately before the first sub-step,
  not at the top of a higher-level section; place them where the reader needs
  them, not earlier.

## Cognitive load

- Defer explanatory content (panel names, concept tables, terminology) until the step where it is first needed; do not front-load reference material.
- Remove or omit any item that is already explained inline in the step that uses it.

## Prerequisites (learned vs. not yet learned)

- Use the order in `content/**/_meta.ts` as the source of truth for what is already learned.
- If a page/exercise would require an unlearned API or syntax, add prerequisite explanation first or redesign the task.

## Directories and adding pages (Nextra standard)

- The standard framework is Nextra (Next.js + MDX); do not introduce Docusaurus for new course sites.
- Key paths:
  - `content/` (docs), `content/**/_meta.ts` (ordering), `theme.config.tsx` / `src/app/` (routing/layout), `public/` (static).
- Create new pages as “folder pages”:
  - `content/docs/<chapter>/<slug>/index.mdx` (use `index.md` only if no components are needed).
  - Include frontmatter `title` at the top.
  - Place required imports immediately after frontmatter (MDX).
- When adding/splitting pages, update the sibling `_meta.ts` so ordering matches prerequisites (append to the end when unsure).

## Exam content layout (`content/exams`)

- Split by year: `content/exams/<year>/...` where `<year>` is numeric (e.g. `2026`).
- Use the fixed order: term → exam → kind:
  - `content/exams/<year>/<term>/<exam>/<kind>/index.mdx`
- Do not create pages for grouping-only folders (no `index.mdx`); set their display name in `_meta.ts`.
- Slug conventions:
  - First semester: `1semester`
  - Second semester: `2semester`
  - Midterm: `1midterm-exam`
  - Final: `2final-exam`
  - Overview: `overview`
  - Preparation: `preparation`

## Preparation questions / quizzes (source of truth = plain Markdown)

- Store the *source of truth* as plain Markdown that conforms to `markdown-to-qti/docs/markdown-question-spec.md`.
  - 1 question = 1 file.
  - No frontmatter.
  - Keep the required heading structure (`#`, `## Type`, `## Prompt`, ...).
- Mark question-spec sources explicitly by filename:
  - Use the `.qspec.md` extension (e.g. `q1.qspec.md`).
  - Directory placement is arbitrary; transformation is keyed by the extension.
- In display pages (`index.mdx`), import and render each question (e.g. `import Q1 from './q1.qspec.md'` then `<Q1 />`).
- Course Docs Site renders question-spec Markdown via `@metyatech/course-docs-platform`:
  - `Type: cloze` converts `{{answer}}` to `${answer}` and enables blanks (including inside code blocks).
  - Inside `## Prompt`, `### Exam` is treated as a presentation convention (rendered as a tip callout titled `本試験では`).
  - `## Scoring` is rendered as a note callout titled `採点基準・配点`.
  - `## Explanation` is rendered inside `<Solution>`.
  - Details: `course-docs-platform/docs/markdown-question-spec-course-docs-rendering.md`.

## Admonitions in course pages

- For admonitions in course pages, use only `tip`, `note`, `warning`, `caution`, `important`.
- Unsupported admonition types are authoring errors; fix the source instead of relying on fallback rendering.
- Use `note` for supplementary background info, terminology, naming conventions, and conceptual explanations.
- Use `tip` for step-completion checklists, exercises, placement hints, and positive guidance.
- Use `caution` for troubleshooting steps, error-prone operations, and common mistakes.
- Prefer `:::` callouts over `>` blockquote for all standalone information blocks; reserve `>` blockquote only for quoted speech.

## Page assets (images / downloads)

- Keep page assets page-scoped (no shared asset directory).
- Images live in `content/**/<slug>/img/...`:
  - Inline Markdown images: `![...](./img/example.png)`
  - When an image must be loaded in MDX code: `import exampleUrl from './img/example.png'`
- Downloadable files live in `content/**/<slug>/assets/...`:
  - `import fileUrl from './assets/<name>';`
  - Use `<DownloadLink file={fileUrl} filename="<name>">...</DownloadLink>`.
  - `DownloadLink` is globally available in MDX pages via `course-docs-platform`; do not wrap imported asset URLs in raw `<a>` tags for downloads.
  - `DownloadLink` routes production downloads through the stable-filename helper automatically and also sets `download="<name>"`.
  - Treat imports as URL strings (do not use `.default`).
- When the same asset is needed in multiple pages, copy it into each page’s `img/` or `assets/` directory (do not create inter-page dependencies).

## Asset build assumptions (Nextra / Next.js)

- The site assumes `@metyatech/course-docs-platform` webpack rules (`applyCourseAssetWebpackRules`) are enabled so `content/**/img` and `content/**/assets` can be imported as URLs.
- If you add an asset and the build fails with loader errors, first check that `next.config.js` uses `@metyatech/course-docs-platform/next`.

## CodePreview (`@metyatech/code-preview`)

- Prefer CodePreview for runnable samples; use normal code blocks for static syntax explanations.
- Do not import `@metyatech/code-preview/styles.css` in pages (styles are injected by the component).
- Put the initial code inside `<CodePreview>...</CodePreview>` as fenced blocks.
  - Use `html` / `css` / `js` / `javascript` language labels (do not omit).
  - HTML blocks contain only `<body>` content (no `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`).
  - Keep CSS and JS in separate blocks; do not inline `<style>` / `<script>` into HTML.
  - CSS formatting: braces on their own lines; `property: value;` with a space after `:`.
- For images referenced from CodePreview, use the `images` map (virtual path → imported URL).
  - Use virtual paths like `img/...` for consistency with page-local images.
- Use `sourceId` to share the same source across multiple previews (unique within the page).
- Panel visibility is controlled via `htmlVisible`, `cssVisible`, `jsVisible`, `previewVisible`.
- For “final demo” previews, show only the preview panel by default.
- For learner-implemented previews, disable sharing (`share={false}`).

## Exercises (`@metyatech/exercise`)

- Use `<Exercise>` and `<Solution>` in MDX pages; they are globally available via `course-docs-platform` and require no import.
  - Place `<Solution>` at the end of the same `<Exercise>`.
- Title the exercise block with a Markdown heading (`###`) placed **before** `<Exercise>`, not inside it; there is no `title` prop.
- Numbering:
  - Use `演習N` / `演習-発展N` (N starts at 1) and keep numbering unique within the page.
- Problem statements must be unambiguous:
  - Provide starting data, steps, how to verify, and a clear target behavior/appearance.
  - Hints are allowed, but do not include “direct answers” (put those in `<Solution>`).
- For styling/visual exercises, show the expected final appearance (preview, image, or equivalent).
- Avoid “essentially the same” exercises:
  - Check already-covered exercises on the page and earlier pages.
  - Prefer different angles (state, multiple events, conditions, accumulation, linked elements, etc.).

## Assessments (exam questions written in Markdown)

- Write questions so there is a single interpretation and a single correct answer.
- Avoid ambiguous verbs like “switch”; specify the exact state transition.
- For UI behavior questions, include a visual target (GIF/image) when feasible.
- For fill-in-the-blank questions, specify the expected answer format and any forbidden answers.
- For external-system blanks, use `${answer}` (multiple answers: `${/regex/}`); do not convert to custom placeholders (e.g. `【1】`).
- If multiple answers are allowed, describe the allowed range explicitly (e.g. `textContent` or `innerText`).

## Tutorial-shot images in `<Action>` components

Tutorial-shot images are PNGs generated from `.shot.json` files in a `shots/`
directory adjacent to the MDX file, using `tutorial-shots-shared.mjs`.
Each annotation in a shot has a `role`: `”action”` (orange solid box) or
`”verify”` (white dashed box).

### Auto-injected legend

When a shot contains both `”action”` and `”verify”` annotations (a *mixed-role*
shot), `remarkInjectTutorialShotLegend` (in `course-docs-platform`) automatically
injects a `<Concept>` legend before the first `<Action>` on the page that
references such a shot.  The legend describes what each box color and line style
means so the learner can read the shot correctly.

- Authors MUST NOT write stroke-color or line-style descriptions in
  `<Action>` text (e.g. “白い破線で囲まれた”, “オレンジの実線で囲まれた”) for
  tutorial-shot images.  The auto-injected legend covers this; inline
  repetition violates the Redundancy principle.
- Authors MUST NOT manually write a `<Concept>` block for the shot legend.
  `remarkInjectTutorialShotLegend` handles injection automatically.  Duplicate
  manual blocks create double legends.

### Keeping the legend text in sync

The legend text is defined by the constants `VERIFY_VISUAL` and `ACTION_VISUAL`
in `course-docs-platform/src/mdx/remark-inject-tutorial-shot-legend.ts`.
When the stroke colors or line styles in `tutorial-shots-shared.mjs` change,
update those constants in the same change set so the legend stays accurate.

Source: agent-rules-private/rules/course-site-repository-architecture.md

## Course docs repository architecture (DRY)

This document describes the canonical repository split for metyatech course documentation sites.
The goal is to keep the system DRY and minimize duplicated “site runtime” code across courses.

### Repositories and responsibilities

- `metyatech/course-docs-site`
  - The **only** runnable site app (Next.js + Nextra).
  - Syncs `content/` and `site.config.ts` from a course content repository at dev/build time.
  - Owns routing, layouts, middleware, and end-to-end tests for the site runtime.
- `metyatech/course-docs-platform`
  - Shared, reusable building blocks consumed by `course-docs-site`.
  - Owns MDX components, remark/rehype config, webpack asset rules, and shared site features.
- `<course>-course-docs` (e.g. `metyatech/javascript-course-docs`, `metyatech/programming-course-docs`)
  - **Content-only** repositories (no Next.js app code).
  - Owns only course content and course-specific configuration.
- `metyatech/programming-course-student-works` (student submissions, large binaries)
  - Student works hosting repository (GitHub Pages).
  - Generates and publishes `works-index.json` for the course site to render the works list.

### Shared runtime boundary rules

- Treat `course-docs-platform` as the source of truth for reusable runtime behavior.
  - Put shared MDX components, shared UI behavior, and shared rendering/runtime integrations in `course-docs-platform`.
- Keep `course-docs-site` as composition/wiring only.
  - Do not add direct imports of shared runtime packages in `course-docs-site` when the behavior belongs in `course-docs-platform`.
- When deciding where to implement a fix, use impact scope first.
  - If the change should apply to multiple courses or any future course site, implement it in `course-docs-platform`.
  - Use `course-docs-site` only for app-shell concerns (routing, layout wiring, middleware, local runtime orchestration, E2E wiring).
- Do not ship temporary site-local duplication of platform behavior.
  - If an urgent site-local patch is unavoidable, migrate it into `course-docs-platform` in the same change set before completion.
- Keep shared dependency ownership aligned with architecture.
  - Dependencies required by platform-owned runtime behavior must be declared in `course-docs-platform`, then consumed via platform exports/APIs from `course-docs-site`.

### Content repository rules (course docs repos)

- Must be content-only:
  - Keep only `content/**`, `public/img/**` (static site assets), and `site.config.ts`.
  - Do not add Next.js/Nextra app runtime files (`next.config.js`, `src/app`, `package.json`, etc.).
- `public/img/favicon.ico` is expected by `site.config.ts` (`faviconHref`).
  - Do not keep framework boilerplate assets (e.g. Docusaurus logos) unless referenced by content.
- Do not store secrets in a content repo:
  - `.env.local` is local-only and belongs in `course-docs-site` (and is gitignored).

### Local development and switching courses

- Always preview locally via `metyatech/course-docs-site` (never by adding app code to a content repo).
- Prefer a local directory for course content while editing:
  - Set `COURSE_CONTENT_SOURCE=../javascript-course-docs` (or `../programming-course-docs`) in `course-docs-site/.env.course.local`.
  - Run `npm run dev` (or `npm run build`) in `course-docs-site`.
- Switching `COURSE_CONTENT_SOURCE` is a supported workflow:
  - The dev launcher restarts on env change and keeps the originally chosen port.
  - `scripts/sync-course-content.mjs` clears `.next` automatically when the course source changes to prevent stale Next.js artifacts.
  - Do not rely on manual “delete `.next`” instructions; treat stale artifacts as a runtime defect and fix the runtime.

### Student works hosting rules

- Do not store `student-works` binaries in a course content repo.
- Prefer a dedicated GitHub Pages repository for works hosting.
- Publish a machine-readable index for the site runtime:
  - `works-index.json` at `<NEXT_PUBLIC_WORKS_BASE_URL>/works-index.json`.
  - The site reads this index server-side to render the works list.

### Deployment rules (Vercel)

- Do **not** use Vercel’s GitHub integration for course sites.
- Deploy via GitHub Actions using the Vercel CLI:
  - Secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
  - The workflow should checkout `metyatech/course-docs-site` and build/deploy it.

### Specs vs. site rendering conventions

- Keep generic, tool-agnostic specs in their dedicated repositories.
  - Example: the plain Markdown question format lives in `markdown-to-qti` (`docs/markdown-question-spec.md`).
- Do **not** add Course Docs Site-specific presentation concepts (e.g. `### Exam`) to generic specs.
  - Document such items as **site rendering conventions** in `course-docs-platform` (and reference them from the course authoring rules).

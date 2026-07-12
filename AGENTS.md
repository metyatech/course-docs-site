<!-- markdownlint-disable MD025 -->
# Tool Rules (compose-agentsmd)

- **Session gate**: before starting substantive work for each externally supplied human/operator instruction, run `compose-agentsmd` once from the project root. AGENTS.md contains the rules you operate under; stale rules cause rule violations. Do not rerun this gate within the same instruction after tool results, retries, generated continuations, or resumed execution. If you discover you skipped this step mid-session, stop, run it immediately, re-read the diff, and adjust your behavior before continuing.
- `compose-agentsmd` intentionally regenerates `AGENTS.md`; any resulting `AGENTS.md` diff is expected and must not be treated as an unexpected external change.
- If `compose-agentsmd` is not available, run it via `npx compose-agentsmd`. If `npx` is unavailable or cannot fetch the package, install it via npm with an environment-appropriate method such as `npm install -g compose-agentsmd` when global installs are permitted, or a user-local npm prefix when global installs are not permitted.
- To update shared/global rules, use `compose-agentsmd edit-rules` to locate the writable rules workspace, make changes only in that workspace, then run `compose-agentsmd apply-rules` (do not manually clone or edit the rules source repo outside this workflow).
- If you find an existing clone of the rules source repo elsewhere, do not assume it is the correct rules workspace; always treat `compose-agentsmd edit-rules` output as the source of truth.
- `compose-agentsmd apply-rules` pushes each GitHub source workspace when its workspace is clean, then regenerates instruction files with refreshed rules.
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

- For web automation or UI verification, use the browser automation tooling available in the current agent environment.
- If browser launch fails due to missing Playwright binaries, run `npx playwright install chromium` and retry.

## UI verification and E2E

- For user-visible UI changes, verify in a real browser; if not possible, explain and provide manual steps.
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

Source: github:metyatech/agent-rules@HEAD/rules/domains/education/course-purpose.md

# Course Teaching Purpose

- Treat the terminal goal of every course as: by graduation, the learner can, with confidence, build the things they want or need, on their own.
- Evaluate course content, sequencing, exercises, lesson structure, quizzes, and exams against that goal.
- Treat the learner's own happiness as the highest-level goal this purpose ultimately serves.
- Apply this purpose to every course, even when time or session count is insufficient to fully reach it.

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
- Questions, prompts, options, answers, scoring criteria, and explanations MUST NOT introduce, require, or casually reference untaught concepts, features, parameters, APIs, syntax, techniques, tools, or extension-only content unless the user explicitly requests extension-level assessment.
- Scoring criteria (also called rubric criteria) are the individual bullet items of a question's `## Scoring` section, each describing one thing the answer must demonstrate.
- The number of scoring criteria and their ordering determine the assessment manifest `points` array: the `points` length MUST equal the criterion count, and each `points` entry maps to the criterion at the same index.
- Questions MUST have a single defensible answer, or explicitly state the
  accepted answer range.
- Multiple-choice distractors MUST be plausible, close to the correct answer,
  and based on likely misconceptions or mistakes.
- Each multiple-choice distractor MUST differ from the correct answer by one
  meaningful concept, target, condition, order, or effect.
- Multiple-choice distractors MUST NOT be obviously unrelated options from a
  different feature area when the question assesses specific technical
  understanding.
- For technical workflow questions, multiple-choice distractors SHOULD remain
  within the same tool, editor, panel, node family, command family, or
  operation category as the correct answer.
- Multiple-choice distractors MAY be obviously wrong only when the learning
  objective is basic vocabulary recognition for first exposure.
- Fill-in questions MUST specify the expected answer format and any forbidden or
  equivalent answers when ambiguity is likely.
- Explanations MUST state the reasoning, concept, procedure, or misconception
  behind the answer.
- Explanations for novice learners MUST be instructional rather than answer-key
  only: include enough reasoning for the learner to repair the misconception.
- When authoring a short question set, order items from lower intrinsic load to
  higher intrinsic load and cover multiple important taught targets rather than
  repeating one surface pattern.

Source: github:metyatech/agent-rules@HEAD/rules/domains/course-docs/authoring.md

# Course Docs Authoring

- Course documentation content MUST be written for beginner learners in clear Japanese unless the task explicitly requests another language.
- Course docs pages MUST use the shared course-docs MDX components when they express page structure, learner actions, verification, concept explanation, reference material, recovery steps, checkpoints, exercises, or answers.
- Use `<Section>`, `<Action>`, `<Verify>`, `<Concept>`, `<Reference>`, `<Recovery>`, `<Checkpoint>`, `<Exercise>`, `<QuickCheck>`, `<Hint>`, and `<Answer>` from `course-docs-platform` for structured tutorial pages.
- A top-level `<Section>` MUST declare `goal`.
- Learner-facing HTML examples MUST use normal HTML void elements without XHTML-style trailing slashes, such as `<input>` rather than `<input />`.
- The void-element rule applies to learner-facing HTML code fences and sample/complete files; it does not apply to MDX/JSX component syntax.
- Exercises MUST use `<Exercise>`, `<Hint>`, and `<Answer>` when the page expects learners to attempt a task and then compare with an answer.
- QuickCheck tasks MUST use `<QuickCheck>`, `<Hint>`, and `<Answer>` when the page expects learners to check understanding and then compare with an answer.
- Every `<Exercise>` and `<QuickCheck>` task MUST be structured as problem content, followed by one or more `<Hint>` blocks, followed by exactly one `<Answer>` block.
- A `<Hint>` MUST NOT reveal the answer first and MUST use only material already covered earlier in the same lesson or in a guaranteed earlier lesson.
- An `<Answer>` MUST include an explanation that corrects likely misconceptions, not only the final answer.
- Course docs MUST NOT use `<Solution>` or `authoringMode`.
- Course docs MUST NOT impose a fixed page-wide order for QuickCheck, Exercise, and extension exercise blocks; place each task where it best supports the learner's progression.
- Exercise headings MUST use `### 演習N` for standard exercises and `### 演習-発展N` for extension exercises.
- Exercise statements MUST include the expected result, success criteria, and enough context for learners to start without guessing.
- Extension exercises MUST be optional and must not be required for the base lesson completion.

## Beginner lesson material ordering

- Materials MUST be written assuming learners will read every word carefully, in natural reading order: top to bottom and left to right.
- At any point in the material, do not introduce a term or feature that has not been explained earlier in that same material (or in a strictly earlier lesson within the same course, when curriculum ordering guarantees it was already taught). Introduce new terms or features at the point where learners first need them.
- "Term or feature" is not limited to HTML/CSS/JS syntax or APIs. It also includes: quoted literal values used in prose or tables (e.g. a string like `active` used as a rule's classification key), variable/identifier names, and any word or metaphor used in a `<Section>`/`<Concept>`/heading title or in body prose, a table cell, or a bullet, before its meaning has been established.
- A `<Concept>` or `<Section>` title MUST NOT rely on a word, abbreviation, or metaphor that is only explained in that block's own body or in a later block. Titles MUST either be self-explanatory to a reader who has not yet read the body, or be phrased so the metaphor/label appears only after the body has explained the underlying idea (e.g. as a closing summary label, not as the heading itself).
- When a rule, table, or summary statement needs to reference a specific value, label, or term (e.g. a classification-rule sentence naming a value to count), the term MUST already be defined by that point, or the sentence MUST explicitly flag it as forthcoming rather than using it as if already known.
- When creating materials, first decide how learners should behave in each section, then write the content so that it naturally leads them to behave that way.
- Introduce only one new concept or element at a time.
- Do not include elements, such as terms, features, code, or markup, that learners will not use or engage with just because they might be realistic or useful later.

### Verification method for this rule

- Checking this rule requires a literal top-to-bottom "cold read" simulation, not a structural/component-level scan. To review material against this rule:
  1. Walk the material from the first word to the last, in rendered reading order, including titles/headings (which render before their own body).
  2. Maintain a running set of terms, values, and metaphors that have been explicitly explained so far.
  3. At each sentence, heading, table cell, and code comment, check every technical term, quoted value, and metaphor against that running set before accepting it as understandable at that point.
  4. Flag the first point where a word could not be resolved by a first-time reader using only what has been read so far. Headings/titles MUST be checked against content read strictly before that heading, never against the body that follows it.
- A structural check (e.g. "does this page use the required MDX components", "is `goal` present") does NOT satisfy this rule's verification requirement and MUST NOT be treated as a substitute for the cold-read simulation above.

Source: github:metyatech/agent-rules@HEAD/rules/domains/course-docs/repository-and-site.md

# Course Docs Repository and Site Architecture

- `metyatech/course-docs-site` is the only runnable Next.js/Nextra course site app.
- `course-docs-site` owns routing, layouts, middleware, site runtime wiring, and end-to-end tests for the site runtime.
- `metyatech/course-docs-platform` owns shared MDX components, remark/rehype configuration, webpack asset rules, and shared course site behavior.
- `<course>-course-docs` repositories are content-only repositories.
- Course content repositories MUST keep only course content, static assets, and course-specific configuration such as `content/**`, `public/img/**`, and `site.config.ts`.
- Course content repositories MUST NOT add Next.js/Nextra app runtime files such as `next.config.js`, `src/app`, app package files, or site runtime implementations.
- `public/img/favicon.ico` is expected by `site.config.ts` when `faviconHref` references it.
- Framework boilerplate assets MUST NOT be kept unless referenced by content.
- Secrets MUST NOT be stored in course content repositories.
- `.env.local` is local-only and belongs in `course-docs-site`, not in content repositories.
- Course content MUST be previewed through `course-docs-site` by setting `COURSE_CONTENT_SOURCE`.
- Shared rendering/runtime behavior that applies to multiple courses MUST be implemented in `course-docs-platform`, not duplicated in `course-docs-site` or content repositories.
- `course-docs-site` MUST remain composition/wiring only for platform-owned behavior.
- Vercel deployment for course sites MUST use GitHub Actions with the Vercel CLI, not Vercel's GitHub integration.
- Generic tool-agnostic specs MUST remain in their dedicated repositories.
- Course Docs Site-specific presentation conventions MUST be documented in `course-docs-platform` or the `course-docs` domain, not in generic specs.
- Course docs pages MUST define page titles in frontmatter.
- `_meta.ts` MUST be used for grouping-only folder labels, not for overriding ordinary page titles.
- Default sidebar collapse behavior MUST be controlled through `theme.config.tsx` sidebar settings.
- `theme.collapsed` MUST be used only for true exceptions.

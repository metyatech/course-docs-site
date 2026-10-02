<!-- markdownlint-disable MD025 -->
# Tool Rules (compose-agentsmd)

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

- For web automation or UI verification, use the browser automation tooling
  available in the current agent environment.
- If browser launch fails due to missing Playwright binaries, run
  `npx playwright install chromium` and retry.

## UI verification and E2E

- For user-visible UI changes, verify in a real browser; if not possible,
  explain and provide manual steps.
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

- Adopt this normative educational purpose: learners enjoy learning with a
  positive outlook while increasing what they can actually do, and use what
  they learn to think, create, and continue learning for themselves.
- Treat this purpose as the system's value judgment, not a unique educational
  purpose established by empirical research.
- Use learning-science evidence to judge means, side effects, and boundary
  conditions for pursuing this purpose.
- Define terminal course outcomes as increased independence in thinking,
  judging, building, solving, and learning within the course's domain.
- For technical or creative courses, interpret building the things learners
  want or need with increasing independence as a concrete domain outcome.
- Evaluate content, sequencing, learning activities, and assessments against
  the purpose and intended outcomes, even when course time is insufficient to
  fully reach them.
- Do not equate enjoyment with ease or rigor with unnecessary frustration.

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
- Educational questions MUST NOT assess content or context specific to a
  particular teaching material, example, exercise, project, story, or classroom
  activity. Use source materials only to establish the taught scope and
  evidence. Rewrite assessment targets as self-contained, transferable
  concepts, features, roles, procedures, judgments, debugging cues, or
  misconceptions that remain valid outside the original teaching artifact.
- Unless an identifier or value is itself an intended learning target,
  questions MUST NOT make recall of incidental source-specific names or values
  part of the answer. This includes work titles, scenarios, characters,
  Blueprint names, class names, function names, variable names, level names,
  file names, message strings, instructor-assigned labels, example-specific
  constants, placements, and outputs. Replace them with generic role-based
  wording while preserving the taught technical distinction.
- Questions, prompts, options, answers, scoring criteria, and explanations MUST
  NOT introduce, require, or casually reference untaught concepts, features,
  parameters, APIs, syntax, techniques, tools, or extension-only content unless
  the user explicitly requests extension-level assessment.
- Scoring criteria (also called rubric criteria) are the individual bullet items
  of a question's `## Scoring` section, each describing one thing the answer
  must demonstrate.
- The number of scoring criteria and their ordering determine the assessment
  manifest `points` array: the `points` length MUST equal the criterion count,
  and each `points` entry maps to the criterion at the same index.
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

- Course documentation content MUST be written for beginner learners in clear
  Japanese unless the task explicitly requests another language.
- Use shared `course-docs-platform` MDX components for page structure, learner
  actions, explanations, checks, exercises, answers, references, and recovery
  support.
- Common components include `<Section>`, `<Action>`, `<Concept>`, `<Reference>`,
  `<Verify>`, `<QuickCheck>`, `<Checkpoint>`, `<Exercise>`, `<Evidence>`,
  `<Hint>`, `<Answer>`, and `<Recovery>`. `<Instruction>` and `<ProblemSolving>`
  are Learning System stage markers, not general-purpose containers.
- Section `goal` is optional learner-facing orientation at every depth,
  including Event-bearing Sections; its presence is not Evidence.
- Learner-facing HTML examples MUST use normal HTML void elements without
  XHTML-style trailing slashes, such as `<input>` rather than `<input />`. This
  applies to HTML code fences and sample/complete files, not MDX/JSX components.
- Course docs MUST NOT use `<Solution>` or `authoringMode`.

## Research provenance

- Classify pedagogical claims by provenance before turning them into rules:
  - `R` — supported in the same direction by multiple independent studies or
    research syntheses within relevant boundary conditions.
  - `S` — a multi-study research synthesis whose inference chain is explicit
    and uses only research-supported premises.
  - `L` — a local, normative, product, authoring, or platform decision.
  - `U` — unresolved by the available research.
- Do not promote a claim to `R` or `S` by combining one research result with
  unaudited design intuition. For `S`, the supporting studies and inference
  chain MUST be traceable in the tutorial-authoring research foundation.
- `U` items MUST NOT become pedagogical authoring rules merely to fill a design
  gap. Gather more evidence or keep the choice explicitly local/experimental.
- Keep `L` contracts explicit; strict enforcement does not make a local rule a
  scientific finding.

## Learning System contract

- A Learning Unit is a canonical objective or capability with a stable ID.
  Define each Unit exactly once in the course-root `learning-units.yaml`; do not
  duplicate its `objective` in MDX.
- Units MAY have parent-child hierarchy. The platform derives Composite status
  for Units with children and Leaf status for Units without children. A
  Composite MAY have no direct Event; each Leaf MUST have Learning Event
  coverage.
- A Learning Event is one occurrence of how the learner learns targeted Units.
  Represent it with metadata on an existing `<Section>`. One Event MUST be
  contained in one MDX page; do not reuse an Event ID across pages or nest
  Event-bearing Sections.
- A Page is a display/distribution unit, not a Learning Unit. Derive course
  progression from the ordered Learning Events; do not maintain a separate
  Learning Plan or teacher lesson graph.
- Event metadata uses `eventId`, `targets`, and `phase`; `pattern` is required
  only for an initial Event. `strategy="productive-failure"` is optional and
  valid only for an initial, problem-solving-first Event.
- Valid `phase` values are `initial`, `practice`, `retrieval`, and `transfer`.
  Initial Events MUST set `pattern` to `instruction-first` or
  `problem-solving-first`; non-initial Events MUST NOT set `pattern`.
- Initial Events MUST use `<Instruction>` and `<ProblemSolving>` as explicit
  stage markers, each as a direct child of the Event Section. Markers MUST NOT
  appear outside an initial Event, inside non-initial Events, or nest inside one
  another.
- Order the stage markers to match `pattern`: Instruction before ProblemSolving
  for `instruction-first`, and ProblemSolving before Instruction for
  `problem-solving-first`.
- Do not treat Productive Failure as another name for problem-solving-first.
  Follow the platform metadata contract without inventing an agent-side semantic
  test for whether an Event qualifies.

## Tasks and aligned evidence

- Exercise and QuickCheck tasks MUST present the problem, then zero or more
  `<Hint>` blocks, then exactly one `<Answer>` block.
- The first Hint SHOULD avoid unnecessarily revealing the answer immediately.
  Multiple Hints MAY become progressively stronger or more explicit.
- Hints SHOULD default to material already covered in this or a guaranteed
  earlier lesson. Hints MAY explicitly teach new information; they MUST NOT
  require unfamiliar information as already known without explaining it.
- Answers MUST provide feedback that lets learners understand correctness.
  Answers MAY be concise for simple, self-explanatory tasks when additional
  explanation adds no learning value. Explain the reasoning or address a likely
  misconception when it helps the learner; do not invent a misconception.
- When present, Hints MUST be non-empty direct children of the task before its
  final Answer; they MAY provide progressively stronger support.
- Exercise is a task/container format, not a learning phase. Near-copy and
  routine application tasks MAY use `<Exercise>`; the component name alone does
  not make a task transfer.
- In Learning System content, bind objective evidence with metadata-only
  `<Evidence>` around an existing learner-facing surface when an explicit
  evidence mapping is needed. Allowed surfaces are `<Verify>`, `<QuickCheck>`,
  `<Checkpoint>`, and `<Exercise>`; `demonstrates` is `application`,
  `retrieval`, or `transfer`.
- Do not infer evidence kind from a component name. `<Recovery>` is not an
  Evidence surface. `<Evidence>` supplies a binding; it is not assessment UI.
- For the local Course Docs `phase="transfer"`, use a deliberately strict
  operational criterion: the learner MUST select and adapt a learned principle
  under meaningfully changed conditions. Changing only values, names, or
  materials in a near-copy does not satisfy this local phase criterion.
  This is a Course Docs contract, not a universal scientific definition of
  transfer; research also studies near transfer under smaller changes.
- Design appropriate evidence for Unit objectives at suitable points in the
  Event/course progression; do not require Section-local closure.
  Choose assessment surfaces based on needed evidence: `<Verify>` for
  observable state,
  `<QuickCheck>` for retrieval or understanding, `<Checkpoint>` for a
  multi-condition milestone, or `<Exercise>` for application or transfer tasks.
  This is a selection guide; component type alone does not determine evidence
  kind.
- Immediate success shows current performance, not durable mastery. Later
  recurrence alone does not establish distributed practice. Do not model spacing
  or interleaving as a single Event attribute.
- `<Recovery>` supports error diagnosis and recovery; it is not learning-goal
  closure. The platform currently reports missing explicit objective evidence as
  a note; do not describe that note as an enforced build failure.
- Do not impose a fixed page-wide order for QuickCheck, Exercise, and extension
  exercises; place tasks where they support the learner's progression.
- Exercise headings SHOULD identify the task; numbering is optional, for
  example `### 演習1：価格だけ色を変える`. Extension headings MUST make the
  extension task explicit. Exercise statements MUST give the expected result,
  success criteria, and enough context to start without guessing. Extension
  exercises MUST be optional and not required for base lesson completion.

## Learner-facing explanations and guidance

- A `<Concept>` SHOULD focus on conceptual knowledge needed to understand or
  perform a current or near learning activity. Near-first-use placement is a
  default; earlier pre-training, summary, retrieval, or reference contexts MAY
  be appropriate. Sentence counts are review triggers for mixed concepts or
  reference detail, not preferred lengths, hard limits, or research thresholds.
- Do not rely on an unexplained concept as already known. Explain the
  characteristics or relations the learner must understand before an activity
  depends on that understanding; do not impose a fixed local sequence for doing
  so.
- A new term may first appear in a heading or title; its name alone does not
  introduce the concept. When first named there, the heading/title and its
  explanation MUST make the meaning explicit before understanding of the term
  is required. Do not assume the learner already knows it or require a glossary
  before every first textual appearance. Headings SHOULD predict the task,
  topic, or capability.
- Exact literal values, identifiers, and metaphors may appear before their
  meaning is explained; explain them before relying on the learner to know what
  they mean. Use cold-read review to detect accidental difficulty: unexplained
  prerequisites, ambiguous instructions, missing state, unnecessary backtracking,
  undefined assumptions, terminology gaps, and visual/prose mismatches.
- As a Course Docs research synthesis, review whether a learner-facing
  heading, its immediate explanation, the task statement, and relevant UI cues
  ask for the same learner action at the same stage. Treat a mismatch as a
  learner-facing defect when it leaves the learner unsure whether to look,
  write, choose, fix, try, check, answer, or create. Natural paraphrases are
  fine when they describe the same action; do not enforce identical words.
  Multiple actions are fine when their order is explicit and each stage is
  clear. Cold-read question: “この見出しを読んで learner が予想する次の行動と、実際に次に要求される行動は一致しているか”
  This is a Course Docs research synthesis from heading/signaling, coherence,
  and consistent task-action mapping evidence; it is not a directly tested rule
  about particular verb pairs.
- Review sequence / discourse continuity as a broader cold-read question than
  learner-action consistency. Especially in novice-oriented initial
  instruction, make it clear from the learner's current state why the next
  topic, operation, or concept appears now. A concise bridge may connect a
  learner goal, an observed result, a limitation of the current method, the
  need for a next concept or operation, or an explicit transition. Do not make
  learners infer a logical bridge that the material can state briefly.
  Cold-read questions:
  - “この部分は、直前まで読んだ learner にとって『なぜ今この話？』にならないか”
  - “新しい概念・道具・操作は、その必要性が生じてから導入されているか”
  - “見出しだけ先に読んだとき、learner state より先の結論へ飛んでいないか”
  - “前の結果 → 次の説明・操作の因果や目的が自然につながっているか”
  This is a bounded research synthesis for novice initial instruction, not a
  requirement to add transitions between every paragraph or to maximize
  coherence for every learner. Preserve intentional
  inference in retrieval and problem-solving activities; do not impose this as
  a universal high-coherence rule for learners with substantial prior knowledge.
- Keep an explanation needed for a later QuickCheck or operation on the main
  instructional path rather than relying only on a Hint, collapsed content, or
  optional callout. Keep mutually dependent operations, results, and
  explanations close enough to integrate without unnecessary search or split
  attention. Do not impose a fixed ordering among them unless the intended
  learning activity itself requires one.
- Review learner-facing orientation (including page introductions, prerequisite
  callouts, objective summaries, Section goals, previews, and sequence
  announcements) for concrete value to the current activity, structure, or
  decision at that point. Rework or remove candidates that only restate a
  heading or adjacent prose, a guaranteed course sequence, a canonical Unit
  objective, or information the learner cannot yet use. This review does not
  reject objectives or advance organizers. Klauer (1984) found that presenting
  behavioral objectives, learning directions, or questions before instructional
  text improved goal-relevant learning, reduced goal-irrelevant learning, and
  slightly improved overall learning; effects depended on text/task conditions
  ([Klauer, 1984](https://doi.org/10.3102/00028312021002323)). Hamilton (1985)
  provides a context-sensitive framework for evaluating adjunct questions and
  objectives that accounts for text structure and learner characteristics; it
  is not direct evidence that objectives are effective
  ([Hamilton, 1985](https://doi.org/10.3102/00346543055001047)). Advance
  organizers may facilitate learning and retention
  ([Luiten, Ames, & Ackerson, 1980](https://doi.org/10.3102/00028312017002211)).
- A term may appear in orientation or a heading before it is explained. If the
  learner needs its meaning to understand or act, explain it before relying on
  that understanding; a name-only list is not pre-training. Mayer's multimedia
  pre-training principle concerns learning the names and characteristics of
  main concepts before a complex multimedia lesson. Applying it to Course Docs
  text/code tutorials by explaining a needed relation before an activity depends
  on it is a bounded application, not a finding directly established by Mayer.
  Use pre-training when the later activity needs it; do not require explanation
  before every first appearance or pre-training in every lesson.
- Prior knowledge being important does not make a prerequisite callout useful
  on every page. In a guaranteed linear progression, do not add one mechanically
  when it adds no actionable preparation, re-entry, or recovery value; retain it
  when it helps learners make a relevant decision or act on a real use.
- Preserve intended retrieval effort, problem solving, decision making,
  productive struggle, and changed-condition transfer during cold-read review.
- When a task is intended to elicit retrieval or learner generation, the
  learner-visible prompt and default pre-attempt material MUST NOT reveal the
  target response or a decisive cue in a way that removes the intended
  retrieval or generation before the learner's first attempt. If the response
  is deliberately supplied as worked or guided instruction, do not count that
  attempt as evidence of unaided retrieval or generation. This narrow principle
  is supported by research on classroom retrieval practice and the generation
  effect ([Agarwal, Nunes, & Blunt, 2021](https://doi.org/10.1007/s10648-021-09595-9);
  [Bertsch, Pesta, Wiscott, & McDaniel, 2007](https://doi.org/10.3758/BF03193441));
  it does not prescribe withholding answers in other task types.
- Prioritize clarity over brevity; retain needed causal relations, UI/state
  correspondence, action purpose, state transitions, and term meanings.
- Introduce only concepts and elements learners will use or engage with; do not
  add later-use realism without a learning need.
- Before choosing representation or assistance, identify whether the intended
  goal is initial performance, learning (including retention), transfer, or a
  deliberate combination. Do not optimize only initial performance when
  learning or transfer is an explicit goal.
- Choose the most efficient primary representation for the task and goal: visual
  for spatial UI/layout information, code or CodePreview for code authoring,
  text for short non-spatial operations, and diagrams/visuals for structural
  relationships. Do not add images merely because a step is operational.
- Make genuinely important, task-relevant information visually distinctive and
  limit competing emphasis so the signal remains informative. Do not infer an
  exact colour, border, radius, or size from signaling research.
- Use proximity, common region, alignment, or other grouping cues to communicate
  real semantic grouping when learners must integrate related information.
  Treat the exact visual encoding as a local design choice unless directly
  supported by applicable evidence.
- Keep task-action mappings and cues consistent when they represent the same
  meaning or operation. Do not treat surface uniformity by itself as a learning
  principle.
- Treat one `<Action>` as one coherent learner action episode toward an
  immediate sub-goal. It MAY contain a short, locally unified sequence (for
  example, click → open menu → hover → choose) when splitting each click would
  increase integration cost.
- Do not duplicate a complete procedure across primary representation and prose
  merely for repetition. Short labels, identifiers, numbers, positional cues,
  and exact values MAY appear in both when they reduce search or integration
  cost.
- An `<Action>` MUST be executable without guessing. For a visual-primary
  Action, prose MAY add complementary details instead of repeating the full
  visual path, provided essential visual instructions have a complete accessible
  text-equivalent route.
- Preserve accessibility-equivalent instructions; avoid competing duplicate
  paths when the platform can expose an equivalent accessibly or on demand.
- For a new procedure with low or unestablished prior knowledge, provide enough
  worked or guided support before substantial independent construction. Fade,
  retain, or restore assistance based on established prior knowledge and learner
  performance; do not use a fixed second-time/third-time rule.
- Aim for appropriate assistance for the learner, performance, and goal;
  guidance minimization is not an objective.
- Design meaningful learner processing such as retrieval, explanation,
  prediction, comparison, selection, organization, debugging, adaptation, or
  creation where the outcome needs it; do not require it on every job-aid or
  initial-performance-only page.
- Support positive engagement through authentic relevance, meaningful challenge,
  visible progress, competence-supportive feedback, or meaningful choice and
  learner control when useful; do not impose all of these as a checklist.
- Do not invent relevance or add choice solely for its own sake.
- Learner-facing prose MUST NOT contain author-facing audience descriptions such
  as `受講者は〜`, `学習者は〜`, or `初学者向け` when they do not help perform the task.
  Rewrite these as direct task prose. Do not ban `ユーザー` when it refers to a real
  product/domain end user rather than the tutorial reader.
- Informative tutorial visuals MUST have text alternatives appropriate to their
  role. For complex annotated screenshots or diagrams, use short `alt` text for
  purpose/identity and put the detailed equivalent in adjacent learner-visible
  text or another long-description mechanism.
- Screenshot annotation text and images of text MUST meet WCAG 2.2 SC 1.4.3
  contrast: 4.5:1 for normal text and 3:1 for large text. Meaningful non-text
  callout shapes and UI-state indicators MUST meet the applicable 3:1 non-text
  contrast requirement. Prefer real text over images of text when practical.

Source: github:metyatech/agent-rules@HEAD/rules/domains/course-docs/repository-and-site.md

# Course Docs Repository and Site Architecture

- `metyatech/course-docs-site` is the Course Docs monorepo and the only runnable
  Next.js/Nextra course site app. The runnable site remains at the repository
  root.
- `packages/platform` is the internal workspace package named
  `@metyatech/course-docs-platform`.
- The monorepo MUST keep a single root `package-lock.json`; workspace packages
  MUST NOT contain their own lockfiles.
- `packages/platform` owns shared MDX components, remark/rehype configuration,
  webpack asset rules, reusable Next app factories/routes, and shared
  course-site behavior.
- The root site owns content synchronization, site composition, deployment
  wiring, development tooling, and end-to-end tests. Root site code MUST remain
  composition/wiring for platform-owned behavior.
- Shared behavior that applies to multiple courses belongs in
  `packages/platform`.
- Site/platform cross-boundary changes MUST be committed and verified atomically
  in the same repository. Platform, site, course build, and end-to-end
  verification MUST run together for changes crossing this boundary.
- The archived `metyatech/course-docs-platform` repository is historical only.
  Active code MUST NOT depend on it through Git, GitHub SHA dependencies,
  submodules, or subtree synchronization.

## Course content repositories

- Course content repositories are content-only. They MAY contain `content/**`,
  static assets such as `public/img/**`, `site.config.ts`, and course-specific
  data such as `learning-units.yaml`.
- `learning-units.yaml` MUST be at the course root when used. It is the
  canonical course-specific Learning Unit/objective model, not site or runtime
  implementation. Require it when MDX uses Learning System Event metadata or
  components such as `<Evidence>`; do not require it for legacy content that has
  not adopted the Learning System.
- Course content repositories MUST NOT add Next.js/Nextra app runtime files such
  as `next.config.js`, `src/app`, app package files, or site runtime
  implementations.
- `public/img/favicon.ico` is expected by `site.config.ts` when `faviconHref`
  references it. Framework boilerplate assets MUST NOT be kept unless referenced
  by content.
- Secrets MUST NOT be stored in course content repositories. `.env.local` is
  local-only and belongs in `course-docs-site`, not in content repositories.
- Preview course content through `course-docs-site` by setting
  `COURSE_CONTENT_SOURCE`.
- Vercel deployment for course sites MUST use GitHub Actions with the Vercel
  CLI, not Vercel's GitHub integration.

## Course structure and navigation

- A Page is a display/distribution unit, not a pedagogical Learning Unit.
  Learning Event order is the source for actual course material progression; do
  not treat a page, Nextra navigation entry, or file path as a Learning Unit or
  substitute it for Event order.
- Course Docs MAY use Nextra navigation order where it represents material
  progression. If navigation order is incomplete, progression may be uncertain;
  a path-based fallback MUST NOT be described as lesson order.
- Do not require a separate session plan or teacher lesson graph when Learning
  Events already express progression.
- Generic tool-agnostic specs MUST remain in their dedicated repositories.
  Course Docs Site-specific presentation conventions belong in
  `course-docs-platform` or the `course-docs` domain, not generic specs.
- Course docs pages MUST define page titles in frontmatter.
- `_meta.ts` MUST be used for grouping-only folder labels, not for overriding
  ordinary page titles.
- Default sidebar collapse behavior MUST be controlled through
  `theme.config.tsx` sidebar settings. `theme.collapsed` MUST be used only for
  true exceptions.

<!-- markdownlint-disable MD025 -->
# Tool Rules (compose-agentsmd)

- **Session gate**: before responding to ANY user message, run `compose-agentsmd` from the project root. AGENTS.md contains the rules you operate under; stale rules cause rule violations. If you discover you skipped this step mid-session, stop, run it immediately, re-read the diff, and adjust your behavior before continuing.
- `compose-agentsmd` intentionally regenerates `AGENTS.md`; any resulting `AGENTS.md` diff is expected and must not be treated as an unexpected external change.
- If `compose-agentsmd` is not available, install it via npm: `npm install -g compose-agentsmd`.
- To update shared/global rules, use `compose-agentsmd edit-rules` to locate the writable rules workspace, make changes only in that workspace, then run `compose-agentsmd apply-rules` (do not manually clone or edit the rules source repo outside this workflow).
- If you find an existing clone of the rules source repo elsewhere, do not assume it is the correct rules workspace; always treat `compose-agentsmd edit-rules` output as the source of truth.
- `compose-agentsmd apply-rules` pushes the rules workspace when `source` is GitHub (if the workspace is clean), then regenerates `AGENTS.md` with refreshed rules.
- Do not edit `AGENTS.md` directly; update the source rules and regenerate.
- `tools/tool-rules.md` is the shared rule source for all repositories that use compose-agentsmd.
- Before applying any rule updates, present the planned changes first with an ANSI-colored diff-style preview, ask for explicit approval, then make the edits.
- These tool rules live in tools/tool-rules.md in the compose-agentsmd repository; do not duplicate them in other rule modules.

Source: github:metyatech/agent-rules@HEAD/rules/global/agent-rules-composition.md

# Rule composition and maintenance

- AGENTS.md is self-contained; place at project root. Shared rules centrally; project-local only for truly local policies.
- Before work in a repo with `agent-ruleset.json`, run `compose-agentsmd` to refresh AGENTS.md.
- Pre-commit hooks run `compose-agentsmd --compose` and auto-stage. Do not fail commits on drift or add freshness checks to CI.

## Update and editing

- Never edit AGENTS.md directly; update source rules and regenerate. "Update rules" = update module/ruleset, then regenerate.
- Persistent user instructions → encode in appropriate module (global vs local) in the same change set.
- New repos must meet all global rules (AGENTS.md, CI, linting, community health, docs, scanning) before reporting complete.
- Update rulesets for missing domain rules before proceeding. Omit AGENTS.md diffs unless asked.
- Infer core intent; prefer global over project-local. Keep rules MECE, concise, non-redundant, action-oriented ("do X", "never Z"). No hedging or numeric filename prefixes.
- Placement: based on where needed. Any-workspace → global; domain only for opt-in repos.

## Size budget

- Total ≤350 lines; per-module ≤30 (soft). Overage → extract procedural content to skills.
- **Rules** = invariants (always loaded, concise). **Skills** = procedures (on-demand, detailed).

Source: github:metyatech/agent-rules@HEAD/rules/global/autonomous-operations.md

# Autonomous operations

- Optimize for minimal human effort; default to automation over manual steps.
- Drive work from the desired outcome: choose the highest-quality safe path and execute end-to-end.
- Correctness, safety, robustness, verifiability > speed unless requester explicitly approves the tradeoff.
- End-to-end repo autonomy (issues, PRs, pushes, merges, releases, admin) within user-controlled repos; third-party repos require explicit request.
- No backward compatibility unless requested; no legacy aliases or shims.
- Proactively fix rule gaps, redundancy, or misplacement; regenerate AGENTS.md without waiting.
- Self-evaluate continuously; fix rule/skill gaps immediately on discovery. In delegated mode, include improvement suggestions in the task result.
- On user-reported failures: treat as systemic — fix, update rules, check for same pattern elsewhere, in one action.
- Persistent workflow promises → propose rule update immediately (blocking gate). In delegated mode, follow that module's restricted-operations guidance.
- Session memory resets; use rule files as persistent memory. Always reference current AGENTS.md, never from memory.
- Rules are source of truth; update conflicting repos to comply or encode the exception.
- When the `manager` skill is invoked, maintain that role for the session unless user explicitly stops it.
- Investigate unclear items before proceeding; no assumptions without approval. Make scope/risk/cost/irreversibility decisions explicit.
- Prefer async control channels (GitHub Issues/PR comments). Design high-volume workflows with queuing and throttling.

## GitHub notifications

- After addressing a notification, mark as done via GraphQL `markNotificationsAsDone`. Detailed procedures in the `manager` skill.

Source: github:metyatech/agent-rules@HEAD/rules/global/cli-standards.md

# CLI standards

- When building a CLI, follow standard conventions: --help/-h, --version/-V, stdin/stdout piping, --json output, --dry-run for mutations, deterministic exit codes, and JSON Schema config validation.

Source: github:metyatech/agent-rules@HEAD/rules/global/command-execution.md

# Workflow and command execution

## MCP server setup verification

- After adding or modifying an MCP server configuration, immediately verify connectivity using the platform's MCP health check and confirm the server is connected.
- If a configured MCP server fails to connect, diagnose and fix before proceeding. Do not silently fall back to alternative tools without reporting the degradation.
- At session start, if expected MCP tools are absent from the available tool set, verify MCP server health and report/fix connection failures before continuing.

- Do not add wrappers or pipes to commands unless the user explicitly asks.
- Prefer repository-standard scripts/commands (package.json scripts, README instructions).
- Reproduce reported command issues by running the same command (or closest equivalent) before proposing fixes.
- Avoid interactive git prompts by using --no-edit or setting GIT_EDITOR=true.
- If elevated privileges are required, use sudo directly; do not launch a separate elevated shell (e.g., Start-Process -Verb RunAs). Fall back to run as Administrator only when sudo is unavailable.
- Keep changes scoped to affected repositories; when shared modules change, update consumers and verify at least one.
- If no branch is specified, work on the current branch; direct commits to main/master are allowed.
- Do not assume agent platform capabilities beyond what is available; fail explicitly when unavailable.

Source: github:metyatech/agent-rules@HEAD/rules/global/delivery-hard-gates.md

# Delivery hard gates

These are non-negotiable completion gates for any state-changing work and for any response that claims "done", "fixed", "working", or "passing".

## Acceptance criteria (AC)

- Before state-changing work, list Acceptance Criteria (AC) as binary, testable statements.
- For read-only tasks, AC may be deliverables/questions answered; keep them checkable.
- If AC are ambiguous or not testable, ask blocking questions before proceeding.
- Keep AC compact by default (aim: 1-3 items). Expand only when risk/complexity demands it or when the requester asks.

## Evidence and verification

- Do not run `git commit` until the repo's full verification command has passed in the current working tree. This applies to every commit, not only the final delivery.
- For each AC, define verification evidence (automated test preferred; otherwise a deterministic manual procedure).
- Maintain an explicit mapping: `AC -> evidence (tests/commands/manual steps)`.
- The mapping may be presented in a compact per-item form (one line per AC including evidence + outcome) to reduce verbosity.
- For code or runtime-behavior changes, automated tests are required unless the requester explicitly approves skipping.
- Bugfixes MUST include a regression test that fails before the fix and passes after.
- Run the repo's full verification suite (lint/format/typecheck/test/build) using a single repo-standard `verify` command when available; if missing, add it.
- Enforce verification locally via commit-time hooks (pre-commit or repo-native) and in CI; skipping requires explicit requester approval.
- For non-code changes, run the relevant subset and justify.
- If required checks cannot be run, stop and ask for explicit approval to proceed with partial verification, and provide an exact manual verification plan.

## Final response (MUST include)

- A compact goal+verification report. Labels may be `Goal`/`Verification` instead of `AC` as long as it is equivalent.
- `AC -> evidence` mapping with outcomes (PASS/FAIL/NOT RUN/N/A), possibly in compact per-item form.
- The exact verification commands executed and their outcomes.

Source: github:metyatech/agent-rules@HEAD/rules/global/implementation-and-coding-standards.md

# Engineering and implementation standards

- Prefer official/standard framework/tooling approaches.
- Prefer well-maintained dependencies; build in-house only when no suitable option exists.
- Prefer third-party tools/services over custom implementations; prefer OSS/free-tier when feasible and call out tradeoffs.
- PowerShell: `\` is literal (not escape); avoid shadowing auto variables (`$args`, `$PID`); avoid double-quoted `-Command` strings (prefer `-File`, single quotes, or here-strings).
- If functionality is reusable, assess reuse first and propose shared module/repo; prefer remote dependencies (never local paths).
- Maintainability > testability > extensibility > readability.
- Single responsibility; composition over inheritance; clean dependency direction; no global mutable state.
- Avoid deep nesting; guard clauses and small functions; clear intention-revealing names; no "Utils" dumping grounds.
- Prefer config/constants over hardcoding; consolidate change points.
- For GUI: prioritize ergonomics/discoverability, include in-app guidance for all components, prefer established design systems (Material, shadcn/ui, Fluent).
- Keep DRY across code/specs/docs/tests/config/scripts; refactor repeated procedures into shared config with local overrides.
- Fix root causes; remove obsolete/unused code/branches/comments; repair user-controlled tools at source, not via workarounds.
- Ensure failure/cancellation paths tear down allocated resources; no partial state.
- Do not block inside async APIs; avoid synchronous I/O where responsiveness is expected.
- Avoid external command execution; prefer native SDKs. If unavoidable: absolute paths, safe argument handling, strict validation.
- Prefer stable public APIs; isolate/document unavoidable internal API usage.
- Externalize large embedded strings/templates/rules.
- Do not commit build artifacts (respect `.gitignore`); keep file/folder naming aligned and consistent.
- Do not assume machine-specific environments; use repo-relative paths and explicit configuration.
- Agent temp files MUST stay under OS temp unless requester approves.
- For agent-facing tools/services, design for cross-agent compatibility via standard interfaces (CLI, HTTP, stdin/stdout, MCP).
- After manifest changes, regenerate and commit corresponding lock files in the same commit.

Source: github:metyatech/agent-rules@HEAD/rules/global/linting-formatting-and-static-analysis.md

# Linters, formatters, and static analysis

- Every code repo must have a formatter and a linter/static analyzer for its primary languages.
- Prefer one formatter and one linter per language; avoid overlapping tools.
- Enforce in CI: run formatting checks (verify-no-changes) and linting on pull requests and require them for merges.
- Treat warnings as errors in CI.
- Do not disable rules globally; keep suppressions narrow, justified, and time-bounded.
- Pin tool versions (lockfiles/manifests) for reproducible CI.
- For web UI projects, enforce automated visual accessibility checks in CI.
- Require dependency vulnerability scanning, secret scanning, and CodeQL for supported languages.

Source: github:metyatech/agent-rules@HEAD/rules/global/model-inventory.md

# Model inventory and routing

- Classify tasks into tiers: Free (trivial, Copilot 0x only), Light, Standard, Heavy, Large Context (>200k tokens, prefer Gemini 1M context).
- Before spawning sub-agents, run `ai-quota` to check availability.
- Always explicitly specify `model` and `effort` from the model inventory when spawning agents; never rely on defaults.
- The full model inventory with agent tables, routing principles, and quota fallback logic is maintained in the `manager` skill.

Source: github:metyatech/agent-rules@HEAD/rules/global/multi-agent-delegation.md

﻿# Multi-agent delegation

- Every agent runs in direct mode (human requester) or delegated mode (spawned by another agent, where the delegator is the requester); default to direct mode.
- In delegated mode, delegation is plan approval: do not re-request human approval, respond in English, emit no notification sounds, and report AC/verification concisely to the delegator. If scope must expand, fail back to the delegator with a clear explanation.
- Delegation prompts MUST state delegated mode and approval state, include AC/verification requirements, and focus on task context (agents read repo AGENTS.md automatically).
- If a delegated agent reports read-only/no-write constraints, it MUST run a minimal reversible OS-temp probe (create/write/read/delete) and report the exact failure verbatim.
- Restricted operations require explicit delegation: modifying rules/rulesets, merging/closing PRs, creating/deleting repos, releasing/deploying, and force-pushing/rewriting published history.
- Delegated agents must not modify rules directly; submit rule-gap suggestions in results for delegator review and human approval.
- Delegated agents inherit delegator repository scope but must not expand it; if required capability is unavailable, fail explicitly.

## Cost optimization (model selection)

- Always specify `model` and `effort` when spawning agents; never rely on defaults.
- Minimize total cost (model pricing, reasoning tokens, context, retries).
- Detailed optimization guidance is in the `manager` skill.

## Parallel execution safety

- Do not run concurrent agents that modify the same repository/files; different repositories may run in parallel.
- When conflict risk is unclear, run sequentially.

Source: github:metyatech/agent-rules@HEAD/rules/global/planning-and-approval-gate.md

# Planning and approval gate

- In direct mode, skip approval only for trivial, low-risk, reversible checks: read-only inspection/verification, spawning read-only smoke-check agents, and temp files under OS temp with cleanup.
- Approval required for: file/rule/config edits, dependency/tool changes, git beyond status/diff/log, and external side effects (deploy/publish/API writes/account changes).
- If impact is meaningfully uncertain, request approval.
- Default flow: clarify goal + plan first, then execute after explicit requester approval.
- In delegated mode, delegation itself is plan approval; if scope expansion is needed, fail back to the delegator.
- For potentially state-changing work, clarify details first; do not proceed while ambiguous.
- Allowed before approval: read-only inspection, dependency install, formatters/linters/typecheck/tests/builds (including auto-fix), and deterministic code generation/build steps.
- Before other state-changing execution: restate as AC, produce plan, confirm with requester, and wait for explicit post-plan "yes"; after approval, re-request only if plan/scope changes.
- Do not treat the original task request as plan approval.
- If state-changing work starts without required "yes", stop immediately, report the gate miss, update rules, regenerate AGENTS.md, and restart from the approval gate.
- No bypass exceptions: "skip planning/just do it" means move quickly through the gate, not around it.

## Scope-based blanket approval

- Broad directives (e.g., "fix everything") count as approval for all work within scope including implied follow-up (rebuild, restart, update installs); re-request only for out-of-scope expansion.

## Reviewer proxy approval

- With `autonomous-orchestrator` active, invocation is blanket approval for user-owned repos; orchestrator approves plans via reviewer proxy without asking the human.
- Reviewer proxy validates against rules, error patterns, and quality standards; proceed if approved, escalate to human if concerns remain. Human may override anytime.
- Reviewer proxy never covers restricted operations (create/delete repos, force-push, rewrite history) — these require human approval.
- Orchestrator may apply safe rule changes when reviewer proxy confirms policy consistency; escalate when ambiguous.

Source: github:metyatech/agent-rules@HEAD/rules/global/post-change-deployment.md

# Post-change deployment

After modifying code in a repository, check whether the changes require
deployment steps beyond commit/push before concluding.

## Globally linked packages

- If the repository is globally installed via `npm link` (identifiable by
  `npm ls -g --depth=0` showing `->` pointing to a local path), run the
  repo's build command after code changes so the global binary reflects
  the update.
- Verify the rebuilt output is functional (e.g., run the CLI's `--version`
  or a smoke command).

## Locally running services and scheduled tasks

- If the repository powers a locally running service, daemon, or scheduled
  task, rebuild and restart the affected component after code changes.
- Verify the restart with deterministic evidence (new PID, port check,
  service status query, or log entry showing updated behavior).
- Do not claim completion until the running instance reflects the changes.

Source: github:metyatech/agent-rules@HEAD/rules/global/quality-testing-and-errors.md

# Quality, testing, and error handling

For AC definition, verification evidence, regression tests, and final reporting, see Delivery hard gates.

- Quality (correctness, safety, robustness, verifiability) takes priority over speed/convenience.

## Verification

- If full-suite scope is unclear, run repo-default verify/CI commands rather than guessing.
- CI must run the full suite on PRs and default-branch pushes, require passing status checks for merges; if no CI exists, add one. Do not rely on smoke-only or scheduled-only gates.
- Configure required default-branch checks when permitted; otherwise report the limitation.
- Commit-time automation must run full verify and block commits; before first commit in a session, confirm hooks are installed (install if needed). If impossible, run full verify manually before every commit.
- Never disable checks, weaken assertions/types, or add retries solely to make checks pass.
- If environment limits execution (network/db/sandbox), run the available subset, document skipped coverage, ensure CI covers the remainder.
- For user-facing tools/GUI, run end-to-end manual verification in addition to automated tests; when manual testing finds issues, add failing tests first, then fix.
- Verify scripts must enforce lock-file integrity (manifest/lock drift detection).

## Tests

- Test-first: add/update tests, observe failure, implement fix, observe pass.
- Keep tests deterministic; minimize time/random/external I/O via injection.
- Heuristic waits require condition-based logic, hard deadlines, diagnostics, and explicit requester approval.

## Error handling

- Never swallow errors; fail fast with explicit errors reflecting actual state and input context.
- Validate config/external inputs at boundaries with actionable failure guidance.
- Log minimally with diagnostic context; never log secrets/personal data; remove debugging instrumentation before final patch.
- If required tests are impractical, document the gap, provide manual verification plan, and get explicit approval.

Source: github:metyatech/agent-rules@HEAD/rules/global/release-and-publication.md

# Release and publication

- Include LICENSE in published artifacts (copyright holder: metyatech).
- Do not ship build/test artifacts or local configs; ensure a clean environment can use the product via README steps.
- Define a SemVer policy and document what counts as a breaking change.
- Keep package version and Git tag consistent.
- Run dependency security checks before release.
- Verify published packages resolve and run correctly before reporting done.

## Public repository metadata

- For public repos, set GitHub Description, Topics, and Homepage.
- Assign Topics from the standard set below. Every repo must have at least one standard topic when applicable; repos that do not match any standard topic use descriptive topics relevant to their domain.
  - `agent-skill`: repo contains a SKILL.md (an installable agent skill).
  - `agent-tool`: CLI tool or MCP server used by agents (e.g., task-tracker, agents-mcp, compose-agentsmd).
  - `agent-rule`: rule source or ruleset repository (e.g., agent-rules).
  - `unreal-engine`: Unreal Engine plugin or sample project.
  - `qti`: QTI assessment ecosystem tool or library.
  - `education`: course content, teaching materials, or student-facing platform.
  - `docusaurus`: Docusaurus plugin or extension.
- Additional descriptive topics (language, framework, domain keywords) may be added freely alongside standard topics.
- Review and update the standard topic set when the repository landscape changes materially (new domain clusters emerge or existing ones become obsolete).
- Verify topics are set as part of the new-repository compliance gate.

## Delivery chain gate

- Before reporting a code change as complete in a publishable package, verify the full delivery chain (commit → push → version bump → release → publish → install verify). Do not stop mid-chain.
- Detailed delivery chain procedures are in the `release-publish` skill.

Source: github:metyatech/agent-rules@HEAD/rules/global/skill-authoring.md

# Skill authoring standards

- Follow the Agent Skills open standard (agentskills.io/specification).
- SKILL.md frontmatter: only `name` (lowercase alphanumeric + hyphens, max 64 chars) and `description` (explain trigger conditions).
- SKILL.md body must be platform-agnostic: no platform-specific tool names. Write in terms of intent.
- Platform-specific examples belong in README.md, not SKILL.md.
- Each skill lives in its own repository with SKILL.md at root.
- Install/manage via `npx skills add <owner>/<repo> --yes --global`.
- Default to public repositories; include a LICENSE file (prefer MIT).
- Write SKILL.md and README.md in English; keep instructions concise and action-oriented.
- Do not duplicate rules already covered by AGENTS.md global rules; reference them instead.

Source: github:metyatech/agent-rules@HEAD/rules/global/task-lifecycle-tracking.md

# Task lifecycle tracking

- When an actionable task emerges during a session, immediately record it with `task-tracker add` so it persists on disk regardless of session termination.
- `task-tracker` is the persistent cross-session tracker; session-scoped task tools (e.g., TaskCreate) are supplementary. Always use `task-tracker add` first; session-scoped tools may be used in addition but never as a replacement.
- At the start of any session that may involve state-changing work, run `task-tracker check` and report findings before starting new work.
- When reporting a task as complete, state the lifecycle stage explicitly (committed/pushed/released/etc.); never claim "done" when downstream stages remain incomplete.
- If `task-tracker` is not installed, install it via `npm install -g @metyatech/task-tracker` before proceeding.
- The task-tracker state file (`.tasks.jsonl`) must be committed to version control; do not add it to `.gitignore`.

Source: github:metyatech/agent-rules@HEAD/rules/global/thread-inbox.md

# Thread inbox

- `thread-inbox` is the persistent cross-session conversation context tracker. Use it to preserve discussion topics, decisions, and context that span sessions.
- If `thread-inbox` is not installed, install it via `npm install -g @metyatech/thread-inbox` before proceeding.
- Store `.threads.jsonl` in the workspace root directory (use `--dir <workspace-root>`). Do not commit it to version control.
- At session start, run `thread-inbox inbox` and `thread-inbox list --status waiting` to find threads needing attention; report findings before starting new work.
- Do not create threads for tasks already tracked by `task-tracker`; threads are for context and decisions, not work items.
- If a thread captures a persistent behavioral preference, encode it as a rule and resolve the thread.
- Detailed usage procedures (status model, when to create/add messages, lifecycle) are in the `manager` skill.

Source: github:metyatech/agent-rules@HEAD/rules/global/user-identity-and-accounts.md

# User identity and accounts

- The user's name is "metyatech".
- Any external reference using "metyatech" (GitHub org/user, npm scope, repos) is under the user's control.
- The user has GitHub and npm accounts.
- Use the gh CLI to verify GitHub details when needed.
- When publishing, cloning, adding submodules, or splitting repos, prefer the user's "metyatech" ownership unless explicitly instructed otherwise.

Source: github:metyatech/agent-rules@HEAD/rules/global/writing-and-documentation.md

# Writing and documentation

## User responses

- Respond in Japanese unless the user requests otherwise.
- Always report whether you committed and whether you pushed; include repo(s), branch(es), and commit hash(es) when applicable.
- After completing a response, emit the Windows SystemSounds.Asterisk sound via PowerShell only when operating in direct mode (top-level agent).
- If operating in delegated mode (spawned by another agent / sub-agent), do not emit notification sounds.
- If operating as a manager/orchestrator, do not ask delegated sub-agents to emit sounds; emit at most once when the overall task is complete (direct mode only).

- When delivering a new tool, feature, or artifact to the user, explain what it is, how to use it (with example commands), and what its key capabilities are. Do not report only completion status; always include a usage guide in the same response.

## Developer-facing writing

- Write developer documentation, code comments, and commit messages in English.
- Rule modules are written in English.

## README and docs

- Every repository must include README.md covering overview/purpose, supported environments/compatibility, install/setup, usage examples, dev commands (build/test/lint/format), required env/config, release/deploy steps if applicable, and links to SECURITY.md / CONTRIBUTING.md / LICENSE / CHANGELOG.md when they exist.
- For any change, assess documentation impact and update all affected docs in the same change set so docs match behavior (README, docs/, examples, comments, templates, ADRs/specs, diagrams).
- If no documentation updates are needed, explain why in the final response.
- For CLIs, document every parameter (required and optional) with a description and at least one example; also include at least one end-to-end example command.
- Do not include user-specific local paths, fixed workspace directories, drive letters, or personal data in doc examples. Prefer repo-relative paths and placeholders so instructions work in arbitrary environments.

## Markdown linking

- When a Markdown document links to a local file, use a path relative to the Markdown file.

Source: github:metyatech/agent-rules@HEAD/rules/domains/node/module-system.md

# Node module system (ESM)

- Default to TypeScript (.ts/.tsx); use JavaScript only for tool-required config files.
- Always set "type": "module" in package.json.
- Prefer ESM with .js extensions for JavaScript config/scripts (e.g., next.config.js as ESM).

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
- If browser launch fails due to missing Playwright binaries, run npx playwright install chromium and retry.

## UI verification and E2E

- For user-visible UI changes, verify in a real browser using agent-browser; if not possible, explain and provide manual steps.
- Always add E2E tests for user-visible changes; if no harness exists, add one.
- Run E2E in CI and require it for PR merges; do not defer correctness coverage to scheduled runs.
- For React UI changes, add tests that cover initial mount and at least one update (re-render) path; include unmount/cleanup when relevant.
- If behavior differs between first render and later renders (effects, caching, hydration), cover both paths explicitly.
- Configure E2E to fail fast and avoid auto-opening browsers (headless/no-open).
- For Next.js E2E, prefer next build + next start.
- If Playwright tests fail to launch, clear playwright/.cache and retry.
- When adding/changing links, add tests that verify the target resolves; if not feasible, document manual verification.
- For cross-system integration flows, add an end-to-end test (or a contract test at the boundary). If impractical, document the limitation and get explicit user approval before skipping.
- Use established icon libraries; do not handcraft custom icons or inline SVGs.

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
  - `## Scoring` is rendered as an info callout titled `採点基準・配点`.
  - `## Explanation` is rendered inside `<Solution>`.
  - Details: `course-docs-platform/docs/markdown-question-spec-course-docs-rendering.md`.

## Page assets (images / downloads)

- Keep page assets page-scoped (no shared asset directory).
- Images live in `content/**/<slug>/img/...`:
  - Inline Markdown images: `![...](./img/example.png)`
  - When an image must be loaded in MDX code: `import exampleUrl from './img/example.png'`
- Downloadable files live in `content/**/<slug>/assets/...`:
  - `import fileUrl from './assets/<name>';`
  - Use `<a href={fileUrl} download="<name>">...</a>` (always set `download` to avoid hashed filenames).
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

- Use `<Exercise>` and `<Solution>` from `@metyatech/exercise/client`.
  - Place `<Solution>` at the end of the same `<Exercise>`.
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

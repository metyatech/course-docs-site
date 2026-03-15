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
- Pre-commit hooks must run the repo's full verification suite, then `compose-agentsmd --compose`, then `git add AGENTS.md`. Do not fail commits on drift or add freshness checks to CI.

## Update and editing

- Never edit AGENTS.md directly; update source rules and regenerate. "Update rules" = update module/ruleset, then regenerate.
- Persistent user instructions → encode in appropriate module (global vs local) in the same change set.
- New repos must meet all global rules (AGENTS.md, CI, linting, community health, docs, scanning) before reporting complete.
- Update rulesets for missing domain rules before proceeding. Omit AGENTS.md diffs unless asked.
- Treat AGENTS.md diffs produced by compose-agentsmd as intentional updates: do not discard/revert them unless the requester explicitly asks to drop them.
- When the repository is git-managed, stage those intentional AGENTS.md updates normally (git add) unless the requester explicitly says to exclude them.
- Infer core intent; prefer global over project-local. Keep rules MECE, concise, non-redundant, action-oriented ("do X", "never Z"). No hedging or numeric filename prefixes.
- When updating global rules, encode the underlying general principle rather than the incident-specific example; prefer the broadest wording that still gives clear action.
- Placement: based on where needed. Any-workspace → global; domain only for opt-in repos.

## Size budget

- Total ≤350 lines; per-module ≤30 (soft). Overage → extract procedural content to skills.
- **Rules** = invariants (always loaded, concise). **Skills** = procedures (on-demand, detailed).

Source: github:metyatech/agent-rules@HEAD/rules/global/autonomous-operations.md

# Autonomous operations

- Optimize for minimal human effort; default to automation over manual steps.
- Drive work from the desired outcome: choose the highest-quality safe path and execute end-to-end.
- Correctness, safety, robustness, verifiability > speed unless requester explicitly approves the tradeoff.
- Default to long-term maintainability over short-term optimization.
- End-to-end repo autonomy (issues, PRs, pushes, merges, releases, admin) within user-controlled repos; third-party repos require explicit request.
- No backward compatibility unless requested; no legacy aliases, shims, or temporary fallback behavior.
- Proactively fix rule gaps, redundancy, or misplacement; regenerate AGENTS.md without waiting.
- Self-evaluate continuously; fix rule/skill gaps immediately on discovery. In delegated mode, include improvement suggestions in the task result.
- On user-reported failures: treat as systemic - fix, update rules, check for same pattern elsewhere, in one action.
- Session memory resets; use rule files as persistent memory. Never write to platform-specific local memory files; all persistent behavioral knowledge MUST live in agent rules.
- Rules are source of truth; update conflicting repos to comply or encode the exception.
- Investigate unclear items before proceeding; no assumptions without approval. Make scope/risk/cost/irreversibility decisions explicit.
- In direct mode, treat any normal user instruction as approval for the full in-scope follow-up work needed to satisfy that request, unless the user explicitly narrows scope or higher-priority rules require additional approval.
- After any user instruction, infer and execute the natural delivery chain by default: implementation, testing, debugging, runtime verification, deployment/release when applicable, documentation updates, follow-on defect cleanup, and residual-risk reduction, until the strongest justified terminal state is reached or an irreducible blocker remains.
- When asked to handle PR review feedback, keep running the full PR review loop across successive review rounds without waiting for another user prompt: address feedback, verify, commit/push, re-request the relevant reviewer(s), monitor for new feedback, and repeat until no actionable review feedback remains or a blocker requires user input.
- Do not stop at intermediate milestones or pause for optional reassurance, optional next-step confirmation, or convenience check-ins while actionable in-scope work remains; interrupt only for blockers, mandatory approvals imposed by higher-priority rules, explicit stop/pause instructions, or material scope/risk changes that require user input.
- Do not lower the requested outcome on your own. If the intended end state is not yet fully met, continue working or explicitly return the remaining gap to the user; never treat partial satisfaction as completion by your own judgment.
- Actively consider whether user input carries intent beyond its literal wording, and when it does, state that inferred intent and propose the matching next step.
- If a problem can be fundamentally solved by modifying global rules, solve it by modifying global rules.
- When modifying global rules, choose the shortest rule change that is still sufficient to solve the problem.
- When multiple viable approaches exist, default to the highest-standard option that maximizes long-term quality, maintainability, and durability; lower-standard tradeoffs require explicit user request.

## Autonomous task resolution

- If a verification step (e.g., `npm run verify`, `npm audit`) fails due to known security vulnerabilities, attempt to fix them automatically (e.g., `npm audit fix`). If the fix is successful and verification passes, commit and push the changes to the PR branch.
- If a task is stuck or constantly failing due to quota limits (429 errors), ensure the task state is correctly updated in `task-tracker` so it can resume from the last successful stage in the next execution cycle.
- Do not remain idle on a failing PR if a known automated fix exists.

Source: github:metyatech/agent-rules@HEAD/rules/global/command-execution.md

# Workflow and command execution
## MCP server setup verification
- After adding or modifying an MCP server configuration, immediately verify connectivity using the platform's MCP health check and confirm the server is connected.
- If a configured MCP server fails to connect, diagnose and fix before proceeding. Do not silently fall back to alternative tools without reporting the degradation.
- At session start, if expected MCP tools are absent from the available tool set, verify MCP server health and report/fix connection failures before continuing.
- Do not add wrappers or pipes to commands unless the user explicitly asks.
- Prefer repository-standard scripts/commands (package.json scripts, README instructions).
- Reproduce reported command issues by running the same command (or closest equivalent) before proposing fixes.
- When diagnosing third-party tool failures, check the latest stable release first; if the latest still reproduces the failure, treat upgrade as insufficient, record the verified limitation, and use a deterministic workaround when available.
- Avoid interactive git prompts by using --no-edit or setting GIT_EDITOR=true.
- If elevated privileges are required, use sudo directly; do not launch a separate elevated shell (e.g., Start-Process -Verb RunAs). Fall back to run as Administrator only when sudo is unavailable.
- Keep changes scoped to affected repositories; when shared modules change, update consumers and verify at least one.
- If no branch is specified, work on the current branch; direct commits to main/master are allowed.
- Do not assume agent platform capabilities beyond what is available; fail explicitly when unavailable.
- When building a CLI, follow standard conventions: --help/-h, --version/-V, stdin/stdout piping, --json output, --dry-run for mutations, deterministic exit codes, and JSON Schema config validation.
- Treat `agent-browser` sessions as temporary resources: close them immediately when they are no longer needed, and before concluding a task verify that no sessions spawned for that task remain open.
- For federated identity flows (Google, Apple, Microsoft, GitHub, etc.), when automation-launched browser contexts are blocked, degraded, or risky, hand off only the IdP step to a real browser/session via CDP or explicit user interaction, then resume automation after the redirect; do not try to bypass provider anti-automation or embedded-browser restrictions.
## Codex-only PowerShell safety
- `Remove-Item` (aliases: `rm`, `ri`, `del`, `erase`) ↁEUse: `if ([IO.File]::Exists($p)) { [IO.File]::SetAttributes($p,[IO.FileAttributes]::Normal); [IO.File]::Delete($p) }`
- `Remove-Item -Recurse` (aliases: `rmdir`, `rd`) ↁEUse: `if ([IO.Directory]::Exists($d)) { [IO.File]::SetAttributes($d,[IO.FileAttributes]::Normal); foreach ($e in [IO.Directory]::EnumerateFileSystemEntries($d,'*',[IO.SearchOption]::AllDirectories)) { [IO.File]::SetAttributes($e,[IO.FileAttributes]::Normal) }; [IO.Directory]::Delete($d,$true) }`
- In PowerShell, use `;` for sequential command chaining; never use `&&` or `||` as control-flow operators.
## Post-change deployment
- After modifying code, check whether deployment steps beyond commit/push are needed before concluding.
- If the repo is globally linked (`npm ls -g` shows `->` to local path), rebuild and verify the global binary is functional.
- If the repo powers a running service, daemon, or scheduled task, rebuild, restart, and verify with deterministic evidence.
- Do not claim completion until the running instance reflects the changes.
- Detection and verification procedures are in the `post-deploy` skill.

- **PowerShell native environment**: This is a Windows/PowerShell environment. Do not use Unix commands directly. On Windows, any Bash-tool command containing `pwsh` or `powershell` is invalid; rewrite it to `pwsh`/`powershell -File` with a `.ps1` file before execution. Do not use `-Command`, stdin, heredoc, or `-EncodedCommand` for PowerShell scripts.

Source: github:metyatech/agent-rules@HEAD/rules/global/implementation-and-coding-standards.md

# Engineering and implementation standards

- Prefer official frameworks and well-maintained dependencies.
- Use latest stable versions of packages/tools; document blockers if not.
- Prefer OSS/free-tier services; call out tradeoffs.
- PowerShell: \ is literal; avoid shadowing auto-vars; prefer single quotes.
- Assess reuse first; prefer remote dependencies over local paths.
- Single responsibility; composition over inheritance; clean dependency direction.
- Avoid deep nesting; guard clauses; small functions; intention-revealing names.
- Prefer config/constants over hardcoding; consolidate change points.
- GUI: prioritize ergonomics, in-app guidance, and a natural top-to-bottom/left-to-right flow from current context to next action to result to optional detail.
- Optimize for first-use clarity: use ordinary task language, avoid internal jargon, and make current selection, source choices, and result targets visually obvious in the UI.
- In GUI interactions, follow established expectations for common controls (for example info icons, disclosure toggles, close buttons, tabs, row selection); only deviate when the UX gain clearly outweighs the surprise cost.
- Prefer modern, visually rich UI and purposeful motion when they improve comprehension; avoid horizontal scrolling in primary application UI unless explicitly justified by the task.
- In interactive selection flows, make the current item, the choice list, and the destination of the chosen result visually and spatially explicit. Prefer anchored drawers, callouts, overlays, or similar patterns over detached panels when they improve comprehension.
- Do not treat stylistic richness or "game-like" presentation as success if users cannot immediately tell what is selected now, what they are choosing from, and where the change will apply. Comprehension wins over style.
- Keep DRY across code/docs/tests/config; refactor repeated procedures.
- Fix root causes; remove obsolete code; repair tools at source.
- Ensure failure paths tear down resources; no partial state.
- Do not block async APIs; avoid sync I/O where responsiveness is expected.
- Avoid external command execution; prefer native SDKs.
- Prefer stable public APIs; isolate/document unavoidable internal API usage.
- Externalize large embedded strings/templates/rules; do not commit build artifacts and keep naming aligned.
- No machine-specific environments; use relative paths and explicit config.
- Agent temp files MUST stay under OS temp unless approved.
- Design tools/services for agent-compatibility via standard interfaces (CLI).
- Lifecycle hooks must succeed on clean machines; use npm exec.
- Regenerate and commit lock files after manifest changes.
- **Robust editing**: Run formatter (e.g. clang-format) IMMEDIATELY BEFORE replace to normalize disk state; do not re-read file unless changed externally.

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
- **Orchestrator model**: When spawning an orchestrator (manager/autonomous-orchestrator role), default to `claude-sonnet-4-6` with `medium` effort; use `claude-opus-4-6` with `medium` effort when strict rule compliance is required. Research shows higher effort degrades instruction-following on multi-constraint rule sets (arXiv:2505.11423). Use `high`/`max` effort only for complex reasoning tasks, not for rule compliance.
- **Gemini sub-agent reliability**: Do NOT use Gemini (`gemini` agent type) for sub-agent delegation. Even single Gemini agents hit 429 "No capacity available" server errors frequently, making them unreliable for unattended tasks. Use Claude or Copilot instead. Gemini CLI may be used interactively by the user but not as a spawned sub-agent.

Source: github:metyatech/agent-rules@HEAD/rules/global/multi-agent-delegation.md

# Multi-agent delegation

- Every agent runs in direct mode (human requester) or delegated mode (spawned by another agent); default to direct mode.
- In delegated mode, delegation is plan approval: do not re-request human approval, respond in English, emit no notification sounds, and report AC/verification concisely. If scope must expand, fail back to the delegator.
- Delegation prompts MUST state delegated mode and approval state, include AC/verification requirements, and focus on task context (agents read repo AGENTS.md automatically).
- If a delegated agent reports read-only/no-write constraints, it MUST run a minimal reversible OS-temp probe and report the exact failure verbatim.
- Restricted operations require explicit delegation: modifying rules/rulesets, merging/closing PRs, creating/deleting repos, releasing/deploying, and force-pushing/rewriting published history.
- Delegated agents must not modify rules directly; submit rule-gap suggestions in results for delegator review.
- Delegated agents inherit delegator repository scope but must not expand it; fail explicitly if unavailable.
- Do not run concurrent agents that modify the same repository/files; different repositories may run in parallel. When conflict risk is unclear, run sequentially.
- Do not stop delegated agents merely because they are slow, retrying, or producing weak intermediate output while still making progress.
- Stop a delegated agent only for a concrete reason: repo/file conflict risk, clear divergence from the approved direction, user-owned data risk, or a better-scoped replacement.
- If a delegated agent creates clearly agent-owned temp, plan, or memory files outside the target repo, assess and clean them up automatically; escalate only when ownership or value is genuinely ambiguous.
- When delegated agents are running and there is no other meaningful in-scope work to do locally, prefer waiting for their completion or next material state change rather than repeatedly returning early and polling without progress.

Execution discipline, agents-mcp dispatch configuration, and cost optimization details are in the `manager` skill.

Source: github:metyatech/agent-rules@HEAD/rules/global/planning-and-approval-gate.md

# Planning and approval gate

- **Default approval model**: in user-controlled repositories and for in-scope work, the user's request is plan approval. Do not require a separate explicit "yes" for normal implementation, testing, commits, pushes, releases, or deploys that are part of completing the requested task.
- **Still ask first**: destructive or hard-to-reverse actions, force-push/history rewrite, deleting repos/data, third-party account side effects, billing/permissions changes, or scope expansion beyond the user's request.
- **Uncertain impact**: request approval.
- **Delegated mode**: delegation itself is plan approval; fail back on scope expansion.
- **Blanket approval**: broad directives (e.g., "fix everything") cover all in-scope follow-up; re-request only for out-of-scope expansion.
- PR review feedback handling is always pre-approved; do not ask for approval before addressing PR comments.
- For user-owned publishable packages, explicit requests such as "commit & push" or "complete this fix" include approval for the release/publish chain when release is the normal completion path, unless the user explicitly limits scope.

Reviewer proxy approval procedures are in the `autonomous-orchestrator` skill.

Source: github:metyatech/agent-rules@HEAD/rules/global/quality-and-delivery.md

# Quality and delivery gates
Non-negotiable gates for any state-changing work or any claim of "done", "fixed", "working", or "passing".
1. **BEFORE** state-changing work: list AC as binary, testable statements.
2. **BEFORE** each git commit: repo's full verification suite must pass.
3. **WITH** each AC: define verification evidence.
4. **FOR** code/runtime changes: automated tests required. Bugfixes MUST include a regression test.
5. **ALWAYS**: run repo-standard verify command; if missing, add it.
6. **IN** final response: keep completion reporting concise by default. Maintain AC/evidence internally, and surface explicit AC/evidence sections only when the user requests them or when higher-priority rules require path-by-path accounting.

## Quality principles
- Quality (correctness, safety, robustness, verifiability) > speed/convenience.
- CI must run full suite on PRs/pushes; require passing checks for merges; add CI if missing.
- Commit-time hooks must run full verify and block commits; confirm hooks installed.
- Test-first: add/update tests, observe failure, implement fix, observe pass.
- Never swallow errors; fail fast with explicit context.
- Validate config/external inputs at boundaries.
- For user-facing apps, perform deterministic runtime verification before completion, define the claimed runtime environment matrix, and prefer the least costly faithful verification environment that covers each claimed behavior.
- For systems whose primary behavior depends on multiple clients, environments, or handoff paths, define the claimed primary path matrix up front and make automated verification of each claimed primary path a completion gate, using the least-cost faithful layer that exercises the boundary.
- When evidence differs by client, environment, or path, report each claimed client/environment/path separately as verified, reproduced-as-limitation, or unverified; never generalize evidence across them.
- Anything not directly verified must be reported as unverified or unsupported; use real devices or live environments only when lower-cost faithful environments cannot validate the behavior.
- For authentication, billing, authorization, data persistence, and other critical systems, passing unit/integration tests, CI, build, and health checks is necessary but insufficient; completion requires live or production-like end-to-end verification of the critical user journey.
- If an intended environment cannot be exercised with available tools or access, stop short of a completion claim, state the exact gap, and leave that environment unclaimed until verified.
- For GUI work, include a first-use walkthrough against the primary user goal; functional E2E alone is insufficient when clarity/usability is in scope.
- For GUI work, do not conclude from functional correctness alone: require screenshot-based review plus automated checks for overflow, clipping, wrapping, and clearly visible primary/current state where feasible; if the user still reports confusion, treat that as a failed acceptance gate and add a regression check for that confusion class before concluding.
- For GUI work, perform a whole-screen plausibility review: if the result would look obviously wrong, broken, or visually incoherent to a reasonable user at a glance, treat it as unfinished even when tests pass.
- Never claim bug-free behavior. Report scope, evidence, and residual risk explicitly.
- External checks and reviews are advisory. They can support completion, but they do not justify concluding a task while a known gap against the requested outcome remains.
- For AI review bots, follow the re-triggering procedures in the `pr-review-workflow` skill.
Detailed evidence format and procedures are in the quality-workflow skill.

Source: github:metyatech/agent-rules@HEAD/rules/global/release-and-publication.md

# Release and publication

- Include LICENSE in published artifacts (copyright holder: metyatech).
- Do not ship build/test artifacts or local configs; ensure a clean environment can use the product via README steps.
- Define a SemVer policy and document what counts as a breaking change.
- Keep package version and Git tag consistent.
- Run dependency security checks before release.
- Verify published packages resolve and run correctly before reporting done.
- For public repos, set GitHub Description, Topics, and Homepage. Assign topics from the standard set defined in the `release-publish` skill.
- Before reporting a publishable-package change as complete, verify the full delivery chain (commit → push → version bump → release → publish → install verify). Procedures in the `release-publish` skill.
- For user-owned publishable packages, when the user asks to commit/push or finalize a fix, treat release/publish as in-scope follow-up by default and execute the full delivery chain unless the user explicitly opts out.

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
- CLI: `task-tracker add "desc"` / `check` / `list` / `done <id>` / `remove <id>` / `update <id> --stage <stage>` — use `--stage`, NOT `--status`.
- Persistent stages: `pending`, `in-progress`, `committed`, `released`, `done`.
- Derived display stage: `pushed`. Do not create tracker-only follow-up commits just to record `pushed`; record `committed` in the closing code commit and let `task-tracker` derive `pushed` from upstream reachability of that committed event.
- The task-tracker state file (`.tasks.jsonl`) must be committed to version control; do not add it to `.gitignore`.

Source: github:metyatech/agent-rules@HEAD/rules/global/thread-inbox.md

# Thread inbox

- `thread-inbox` is the persistent cross-session conversation context tracker. Use it to preserve discussion topics, decisions, and context that span sessions.
- If `thread-inbox` is not installed, install it via `npm install -g @metyatech/thread-inbox` before proceeding.
- Store `.threads.jsonl` in the workspace root directory (use `--dir <workspace-root>`). Do not commit it to version control.
- At session start, run `thread-inbox inbox` and `thread-inbox list --status waiting` to find threads needing attention; report findings before starting new work.
- Do not create threads for tasks already tracked by `task-tracker`; threads are for context and decisions, not work items.
- CLI: `thread-inbox new "title" --dir <dir>` (must create before adding messages) / `add <id> --from user|ai "msg" --dir <dir>` / `inbox --dir <dir>` / `list --status <status> --dir <dir>`.
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
- Report commit/push status only when the turn changed files; keep it simple unless the user asks for details.
- In direct mode, emit the Windows SystemSounds.Asterisk sound after completing a response; delegated agents never emit sounds, and managers emit at most once for the overall task.
- When delivering a new tool, feature, or artifact, explain what it is, how to use it, and its key capabilities.
- Prefer short, user-centric progress reports. Explain what the user can now do, not implementation details, unless internals are requested.
- In direct mode, keep intermediary progress reports to the minimum required by higher-priority rules; prefer long uninterrupted execution blocks over frequent narration, and interrupt mid-task only for blockers, mandatory approvals, material risk/scope changes, or final completion.
- Do not include AC/evidence sections or command transcripts in normal user reports unless explicitly requested.
- At the end of a session or task, report any lingering unresolved technical friction or environment issues.
## Developer-facing writing
- Write developer documentation, code comments, commit messages, and rule modules in English.
## README and docs
- Every repository must include README.md covering overview/purpose, supported environments/compatibility, install/setup, usage examples, dev commands, required env/config, release/deploy steps if applicable, and links to SECURITY.md / CONTRIBUTING.md / LICENSE / CHANGELOG.md when they exist.
- For any change, assess documentation impact and update affected docs in the same change set so docs match behavior (README, docs/, examples, comments, templates, ADRs/specs, diagrams).
- If no documentation updates are needed, explain why in the final response.
- For CLIs, document every parameter with a description and at least one example, plus one end-to-end example command.
- Do not include user-specific local paths, fixed workspace directories, drive letters, or personal data in doc examples; prefer repo-relative paths and placeholders.
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

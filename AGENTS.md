<!-- markdownlint-disable MD025 -->
# Tool Rules (compose-agentsmd)
- Before starting any work, run `compose-agentsmd` from the project root.
- To update shared rules, run `compose-agentsmd edit-rules`, edit the workspace rules, then run `compose-agentsmd apply-rules`.
- Do not edit `AGENTS.md` directly; update the source rules and regenerate.
- These tool rules live in tools/tool-rules.md in the compose-agentsmd repository; do not duplicate them in global rule modules.
- When updating rules, include a colorized diff-style summary in the final response. Use `git diff --stat` first, then include the raw ANSI-colored output of `git diff --color=always` (no sanitizing or reformatting), and limit the output to the rule files that changed.
- Also provide a short, copy-pasteable command the user can run to view the diff in the same format. Use absolute paths so it works regardless of the current working directory, and scope it to the changed rule files.
- If a diff is provided, a separate detailed summary is not required. If a diff is not possible, include a detailed summary of what changed (added/removed/modified items).

Source: github:metyatech/agent-rules@HEAD/rules/global/agent-rules-composition.md

# Rule composition and maintenance

## Scope and composition

- AGENTS.md is self-contained; do not rely on parent/child AGENTS for inheritance or precedence.
- Maintain shared rules centrally and compose per project; use project-local rules only for truly local policies.
- Place AGENTS.md at the project root; only add another AGENTS.md for nested independent projects.

## Update policy

- Never edit AGENTS.md directly; update source rules and regenerate AGENTS.md.
- A request to "update rules" means: update the appropriate rule module and ruleset, then regenerate AGENTS.md.
- If the user gives a persistent instruction (e.g., "always", "must"), encode it in the appropriate module (global vs local).
- When acknowledging a new persistent instruction, update the rule module in the same change set and regenerate AGENTS.md.
- When creating a new repository, set up rule files (e.g., agent-ruleset.json and any local rules) so compose-agentsmd can run.
- When updating rules, infer the core intent; if it is a global policy, record it in global rules rather than project-local rules.
- If a task requires domain rules not listed in agent-ruleset.json, update the ruleset to include them and regenerate AGENTS.md before proceeding.
- When rule changes produce a diff, include it in the final response unless the user explicitly asks to omit it.

## Editing standards

- Keep rules MECE, concise, and non-redundant.
- Use short, action-oriented bullets; avoid numbered lists unless order matters.
- Prefer the most general applicable rule to avoid duplication.

Source: github:metyatech/agent-rules@HEAD/rules/global/autonomous-operations.md

# Autonomous operations

- Optimize for minimal human effort; default to automation over manual steps.
- Drive work from the desired outcome: infer acceptance criteria, choose the shortest safe path, and execute end-to-end.
- Assume end-to-end autonomy for repository operations (issue triage, PRs, direct pushes to main/master, merges, releases, repo admin) unless the user restricts scope.
- Do not preserve backward compatibility unless explicitly requested; avoid legacy aliases and compatibility shims by default.
- When work reveals rule gaps, redundancy, or misplacement, proactively update rule modules/rulesets (including moves/renames) and regenerate AGENTS.md without waiting for explicit user requests.
- After each task, run a brief retrospective; if you notice avoidable mistakes, missing checks, or recurring back-and-forth, encode the fix as a rule update and regenerate AGENTS.md.
- Treat these rules as the source of truth; do not override them with repository conventions. If a repo conflicts, update the repo to comply or update the rules to encode the exception; do not make undocumented exceptions.
- When something is unclear, investigate to resolve it; do not proceed with unresolved material uncertainty. If still unclear, ask and include what you checked.
- Do not proceed based on assumptions or guesses without explicit user approval; hypotheses may be discussed but must not drive action.
- Ask only blocking questions; for non-material ambiguities, pick the lowest-risk option, state the assumption, and proceed.
- Make decisions explicit when they affect scope, risk, cost, or irreversibility.
- Prefer asynchronous, low-friction control channels (GitHub Issues/PR comments) unless a repository mandates another.
- Design autonomous workflows for high volume: queue requests, set concurrency limits, and auto-throttle to prevent overload.

Source: github:metyatech/agent-rules@HEAD/rules/global/command-execution.md

# Workflow and command execution

- Do not add wrappers or pipes to commands unless the user explicitly asks.
- Prefer repository-standard scripts/commands (package.json scripts, README instructions).
- Reproduce reported command issues by running the same command (or closest equivalent) before proposing fixes.
- Avoid interactive git prompts by using --no-edit or setting GIT_EDITOR=true.
- If elevated privileges are required, use sudo where available; otherwise run as Administrator.
- Keep changes scoped to affected repositories; when shared modules change, update consumers and verify at least one.
- If no branch is specified, work on the current branch; direct commits to main/master are allowed.
- After addressing PR comments, resolve related conversations; after completing a PR, merge it, sync the target branch, and delete the PR branch locally and remotely.

Source: github:metyatech/agent-rules@HEAD/rules/global/implementation-and-coding-standards.md

# Engineering and implementation standards

- Prefer official/standard approaches recommended by the framework or tooling.
- Prefer well-maintained external dependencies; build in-house only when no suitable option exists.
- If functionality appears reusable, assess reuse first and propose a shared module/repo; prefer remote dependencies (never local filesystem paths).
- Maintainability > testability > extensibility > readability.
- Single responsibility; keep modules narrowly scoped and prefer composition over inheritance.
- Keep dependency direction clean and swappable; avoid global mutable state.
- Avoid deep nesting; use guard clauses and small functions.
- Use clear, intention-revealing naming; avoid "Utils" dumping grounds.
- Prefer configuration/constants over hardcoding; consolidate change points.
- Keep everything DRY across code, specs, docs, tests, configs, and scripts; proactively refactor repeated procedures into shared configs/scripts with small, local overrides.
- Fix root causes; remove obsolete/unused code, branches, comments, and helpers.
- Externalize large embedded strings/templates/rules when possible.
- Do not commit build artifacts (follow the repo's .gitignore).
- Align file/folder names with their contents and keep naming conventions consistent.
- Do not assume machine-specific environments (fixed workspace directories, drive letters, per-PC paths). Prefer repo-relative paths and explicit configuration so workflows work in arbitrary clone locations.

Source: github:metyatech/agent-rules@HEAD/rules/global/linting-formatting-and-static-analysis.md

# Linters, formatters, and static analysis

## General policy

- Every code repo must have a formatter and a linter/static analyzer for its primary languages.
- Prefer one formatter and one linter per language; avoid overlapping tools that fight each other.
- Follow the standard toolchains below. If a repo conflicts, migrate it to comply unless the user explicitly restricts scope.
- If you believe an exception is needed, encode it as a rule update and regenerate AGENTS.md before proceeding.
- Enforce in CI: run formatting checks (verify-no-changes) and linting on pull requests and require them for merges.
- Treat warnings as errors in CI; when a tool cannot, use its strictest available setting so warnings fail CI.
- Do not disable rules globally; keep suppressions narrow, justified, and time-bounded.
- Pin tool versions (lockfiles/manifests) for reproducible CI.

## Security baseline

- Require dependency vulnerability scanning appropriate to the ecosystem (SCA) for merges. If you cannot enable it, report the limitation and get explicit user approval before proceeding without it.
- Enable GitHub secret scanning and remediate findings; never commit secrets. If it is unavailable, add a repo-local secret scanner and require it for merges.
- Enable CodeQL code scanning for supported languages. If it cannot be enabled, report the limitation and use the best available alternative for that ecosystem.

## Default toolchain by language

### JavaScript / TypeScript (incl. React/Next)

- Format+lint: ESLint + Prettier.
- Typecheck: `tsc` with strict settings for TS projects.
- Dependency scan: `osv-scanner`. If unsupported, use the package manager's audit tooling.

### Python

- Format+lint: Ruff.
- Typecheck: Pyright.
- Dependency scan: pip-audit.

### Go

- Format: gofmt.
- Lint/static analysis: golangci-lint (includes staticcheck).
- Dependency scan: govulncheck.

### Rust

- Format: cargo fmt.
- Lint/static analysis: cargo clippy with warnings as errors.
- Dependency scan: cargo audit.

### Java

- Format: Spotless + google-java-format.
- Lint/static analysis: Checkstyle + SpotBugs.
- Dependency scan: OWASP Dependency-Check.

### Kotlin

- Format: Spotless + ktlint.
- Lint/static analysis: detekt.
- Compiler: enable warnings-as-errors in CI; if impractical, get explicit user approval before relaxing.

### C#

- Format: dotnet format (verify-no-changes in CI).
- Lint/static analysis: enable .NET analyzers; treat warnings as errors; enable nullable reference types.
- Dependency scan: `dotnet list package --vulnerable`.

### C++

- Format: clang-format.
- Lint/static analysis: clang-tidy.
- Build: enable strong warnings and treat as errors; run sanitizers (ASan/UBSan) in CI where supported.

### PowerShell

- Format+lint: PSScriptAnalyzer (Invoke-Formatter + Invoke-ScriptAnalyzer).
- Runtime: Set-StrictMode -Version Latest; fail fast on errors.
- Tests: Pester when tests exist.

### Shell (sh/bash)

- Format: shfmt.
- Lint: shellcheck.

### Dockerfile

- Lint: hadolint.

### Terraform

- Format: terraform fmt -check.
- Validate: terraform validate.
- Lint: tflint.
- Security scan: trivy config.

### YAML

- Lint: yamllint.

### Markdown

- Lint: markdownlint.

Source: github:metyatech/agent-rules@HEAD/rules/global/observability-and-diagnostics.md

# Observability and diagnostics

## General policy

- Design for debuggability: make failures diagnosable from logs/metrics/traces without reproducing locally.
- Add observability in the same change set as behavior changes that affect runtime behavior, performance, or reliability.

## Logging

- Prefer structured logs for services; keep field names stable (e.g., level, message, component, request_id/trace_id, version).
- Include actionable context in errors (what failed, which input/state, what to do next) without logging secrets/PII.
- Log at the right level; avoid noisy logs in hot paths.

## Metrics

- Instrument the golden signals (latency, traffic, errors, saturation) for each service and critical dependency; define concrete SLIs/SLOs for user-facing flows.
- Use OpenTelemetry Metrics for instrumentation and OTLP for export; using vendor-specific metrics SDKs directly is an exception and requires explicit user approval.
- Use the right metric types (counters for monotonic totals, histograms for latencies/sizes, gauges for current values) and include explicit units in names.
- Keep metric names and label keys stable; use a consistent namespace and Prometheus-style `snake_case` naming with base-unit suffixes (e.g., `http_server_request_duration_seconds`).
- Constrain label cardinality: labels must come from small bounded sets; never use user identifiers, raw URLs, request bodies, or other unbounded values as labels.
- Ensure correlation: when supported, record exemplars or identifiers that let you jump from a metric spike to representative traces/logs.
- Treat missing/incorrect metrics as a defect when they block verification, incident response, or SLO evaluation; add/adjust dashboards and alerts with behavior changes that impact reliability/performance.

## Alerting

- Alerting is part of the definition of done for reliability/performance changes: update dashboards, alerts, and runbooks in the same change set.
- Define alert severity and routing explicitly; paging alerts must correspond to user-impacting SLO/error-budget burn, not “interesting” internal signals.
- Use multi-window burn-rate alerting to reduce flapping; page only on sustained burn and use ticket-level alerts for slower burn or early-warning signals.
- Every alert must be actionable and owned: include service/team ownership labels and a runbook link that lists diagnosis steps, mitigation steps, and rollback/feature-flag options.
- Every alert must include a dashboard link and relevant identifiers (service, environment, region/cluster) so responders can triage quickly.
- Reduce noise aggressively: delete or downgrade alerts that page without clear user impact; treat alert fatigue and stale/non-actionable alerts as defects.
- Alert rules must be managed as code and reviewed with code changes; manual, ad-hoc changes in vendor UIs are prohibited.
- Alert rules must be automatically validated and tested in CI; for Prometheus-compatible rules this means `promtool check rules` and `promtool test rules`.
- If constraints make “alerts as code” or CI validation impractical, treat it as an exception and require explicit user approval with documented rationale.

## Tracing

- For multi-service or async flows, use OpenTelemetry and propagate context across boundaries (HTTP/gRPC/queues).
- Correlate logs and traces via trace_id/request_id.

## Health and self-checks

- Services must have readiness and liveness checks; fail fast when dependencies are unavailable.
- CLIs should provide a verbose mode and clear error output; add a self-check command when it reduces support burden.

Source: github:metyatech/agent-rules@HEAD/rules/global/quality-testing-and-errors.md

# Quality, testing, and error handling

## Quality priority

- Quality (correctness, safety, robustness, verifiability) takes priority over speed or convenience.

## Definition of done

- Do not claim "fixed"/"done" unless it is verified by reproducing the issue and/or running the relevant checks.
- For code changes, treat "relevant checks" as the repo's full lint/typecheck/test/build suite (prefer CI results).
- Prefer a green baseline: if relevant checks fail before you change anything, report it and get explicit user approval before proceeding.
- If you cannot reproduce/verify, do not guess a fix; request missing info or create a failing regression test.
- Always report verification: list the exact commands/steps run and their outcome; if anything is unverified, state why and how to verify.

## Verification

- Run the repo's full lint/typecheck/test/build checks using repo-standard commands.
- If you are unsure what constitutes the full suite, run the repo's default verify/CI commands rather than guessing.
- Before committing code changes, run the full suite; if a relevant check is missing and feasible to add, add it in the same change set.
- Enforce via CI: run the full suite on pull requests and on pushes to the default branch; if no CI harness exists, add one using repo-standard commands.
- Configure required status checks on the default branch when you have permission; otherwise report the limitation.
- Do not rely on smoke-only gating or scheduled-only full runs for correctness; merges must require the full suite.
- Ensure commit-time automation (pre-commit or repo-native) runs the full suite when feasible.
- If required checks cannot be run, treat it as an exception: explain why, provide exact commands/steps, and get explicit user approval before proceeding.
- Never disable checks, weaken assertions, loosen types, or add retries solely to make checks pass.

## Tests (behavior changes)

- Follow test-first: add/update tests, observe failure, implement the fix, then observe pass.
- For bug fixes, add a regression test that fails before the fix at the level where the bug occurs (unit/integration/E2E).
- Add/update automated tests for behavior changes and regression coverage.
- Cover success, failure, boundary, invalid input, and key state transitions (including first-run/cold-start vs subsequent-run behavior when relevant); include representative concurrency/retry/recovery when relevant.
- Keep tests deterministic; minimize time/random/external I/O; inject when needed.
- For deterministic output files, use full-content snapshot/golden tests.
- Prefer making nondeterministic failures reproducible over adding sleeps/retries; do not mask flakiness.
- For integration boundaries (network/DB/external services/UI flows), add an integration/E2E/contract test that exercises the boundary; avoid unit-only coverage for integration bugs.
- For non-trivial changes, create a small test matrix (scenarios × inputs × states) and cover the highest-risk combinations; document intentional gaps.

## Feedback loops and root causes

- Treat time-to-detect and time-to-fix as quality attributes; shorten the feedback loop with automation and observability rather than relying on manual QA.
- For any defect fix or incident remediation, perform a brief root-cause classification: implementation mistake, design deficit, and/or ambiguous/incorrect requirements.
- Feed the root cause upstream in the same change set: add or tighten tests/checks/alerts, update specs/acceptance criteria, and update design docs/ADRs when applicable.
- If the failure should have been detected earlier, add a gate at the earliest reliable point (lint/typecheck/tests/CI required checks or runtime alerts/health checks); skipping this requires explicit user approval.
- Record the prevention mechanism (what will catch it next time) in the PR description or issue comment; avoid “fixed” without a concrete feedback-loop improvement.

## Exceptions

- If required tests are impractical, document the coverage gap, provide a manual verification plan, and get explicit user approval before skipping.

## Error handling and validation

- Never swallow errors; fail fast or return early with explicit errors.
- Error messages must reflect actual state and include relevant input context.
- Validate config and external inputs at boundaries; fail with actionable guidance.
- Log minimally but with diagnostic context; never log secrets or personal data.
- Remove temporary debugging/instrumentation before the final patch.

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
- After completing a response, emit the Windows SystemSounds.Asterisk sound via PowerShell when possible.

## Developer-facing writing

- Write developer documentation, code comments, and commit messages in English.
- Rule modules are written in English.

## README and docs

- Every repository must include README.md covering overview/purpose, setup, dev commands (build/test/lint), required env/config, and release/deploy steps if applicable.
- For any code change, assess README impact and update it in the same change set when needed.
- If a README update is not needed, explain why in the final response.
- CLI examples in docs must include required parameters.
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

- For web automation, use the agent-browser CLI.
- Prefer the ref-based workflow: agent-browser open <url> -> agent-browser snapshot -i --json -> interact using @eN refs -> re-snapshot after changes.
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

## 教材サイトのメタデータ/サイドバー

- ページのタイトルは各ページの frontmatter（`title`）で定義し、`_meta.ts` では上書きしない。
- ページを持たないフォルダ（`index.mdx` がないグルーピング用途）の表示名は、`_meta.ts` で指定する。
- サイドバーの初期折りたたみは `theme.config.tsx` の `sidebar` 設定（`defaultMenuCollapseLevel` / `autoCollapse`）で制御し、例外が必要な場合のみ `theme.collapsed` を使う。

Source: agent-rules-private/rules/course-site-content-authoring.md

## 教材サイト（本文・演習）作成ルール

本ファイルには、教材サイトに共通して適用する「安定したルール」を中心に記載する。
個別事例・暫定判断・可変仕様・特定リポジトリ固有設定は、原則としてこのファイルに書かない。

### 意思決定の優先順位

教材では「学習効果（分かりやすさ・段階性・再現性）」を最優先する。

## 本文・サンプル

- 教材ページ（`content/` 配下。主に `content/docs/`）の本文・ラベル・出力文は日本語で、学習者が理解できる語彙で書く。
- 本文は冗長にしない。長い説明が必要な場合は、短い段落・箇条書き・小見出しで分割し、段階的に進める。
- 編集者向けメモや方針（例: 「ここでは扱わない」「編集メモ: ...」）やメタ的内容（例: 「AIが考える...」）は本文に入れない。
- 用語・見出し構成・説明の粒度は既存ページのパターンに合わせ、学習者が迷わない一貫性を優先する。
- サンプルは「1サンプル=1トピック」を守り、短く単純にする（長くなる場合は分割/段階化）。
- 識別子（変数名・クラス名・`id` 等）は意図が推測できる短い名前にする。1文字変数は原則避ける（例外: `i`, `j`）。
- 出力があるコードは期待値を併記する（例: `console.log(x); // 出力: ...`）。
- サンプルコード内のコメント（`// ...` / `/* ... */`）は原則日本語で書く（学習者向けのため）。
- コードブロックは言語指定を付ける（例: `js`, `ts`, `html`, `css`）。
- 章の冒頭では「どこで使うか」を1～2文で示して動機付けを行う。
- 実在サイト例を出す場合は、個人情報が表示されるページや認証が必要なページへリンクしない。

## 既習事項の扱い

- 既習/未習の判定は `content/**/_meta.ts` の並び順を基準にする（既習=前のページ + 当該ページ内で説明済み）。
- 未習の API / 構文が必要になる場合は、前提説明を先に追加するか、出題/解説の設計を変更する。

## 主要ディレクトリとページ追加

- 教材サイトのフレームワークは **Nextra（Next.js + MDX）を標準**とし、新規に Docusaurus は採用しない。
- 主要: `content/`（教材）, `content/**/_meta.ts`（並び順）, `next.config.js` / `theme.config.tsx` / `src/app/`（設定・ルーティング）, `public/`（サイト全体の静的ファイル）。
- 新規ページは「フォルダ化ページ」に統一し、`content/docs/<chapter>/<slug>/index.mdx`（コンポーネントを全く使わない場合は `index.md`）に作成する。
  - 先頭に frontmatter（`title`）を設定する。
  - 必要なコンポーネントは frontmatter の直後で import する（MDX）。
- ページを追加/分割した場合は、同階層の `_meta.ts` も更新し、既習事項（上記「既習事項の扱い」）と矛盾しない並びにする（迷う場合は末尾追加を基本とする）。

## ページ資材（img / assets）

- 画像・配布物などページに紐づく資材は「ページ単位」で管理する（共有置き場を作らない）。
- 画像は `content/**/<slug>/img/...` に置く。
  - ページ内表示の画像: `![...](./img/example.png)` のように相対パスで参照する。
  - MDX で読み込みが必要な画像: `import exampleUrl from "./img/example.png";` のように import する。
- 配布（ダウンロード）するファイルは `content/**/<slug>/assets/...` に置く。
  - `import fileUrl from "./assets/<name>";` のように import し、`<a href={fileUrl} download="<name>">...</a>` を使う。
    - `download` を指定しないとハッシュ名になるため、原則として付ける。
    - import はURL文字列を返す前提で扱う（`.default` を付けない）。
- 「同一章内で複数ページ共通」「サイト全体で共通」などの共有置き場は作らない。
  - 複数ページで同じ資材を使い回す場合でも、各ページの `img/` / `assets/` にコピーして持つ（依存関係を作らない）。

## 付属ファイルのビルド前提（Nextra / Next.js のアセット読み込み）

- `content/**/assets/` / `content/**/img/` 配下のファイルを `import` でURLとして扱えるようにするため、教材サイトは `@metyatech/course-docs-platform` の webpack ルール（`applyCourseAssetWebpackRules`）を有効化している前提で運用する。
- 付属ファイルを追加したのにビルドで「loader がない / Module parse failed」等が出た場合は、まず当該教材サイトの `next.config.js` が `@metyatech/course-docs-platform/next` を使っていることを確認する。

## CodePreview（@metyatech/code-preview）

- **実行できるサンプルは CodePreview を優先**（単純な構文説明、非実行コードなどは通常のコードブロックでも可）。
- CodePreview のスタイルはコンポーネント側で注入される前提のため、ページ側で `@metyatech/code-preview/styles.css` を import しない。
- 初期コードは、**`<CodePreview>...</CodePreview>` の中（開始タグと終了タグの間）** にフェンスコードブロックで書く。
  - 言語ラベルは `html` / `css` / `js` / `javascript` を使う（省略しない）。
  - `html` ブロックは、原則 **`<body>` の中に置く内容だけ**を書く（`<!DOCTYPE html>` / `<html>` / `<head>` / `<body>` は書かない）。
  - CSS/JS は、原則、それぞれ `css` / `js`（または `javascript`）の **別ブロック**に分ける（HTML に `<style>` / `<script>` を埋め込まない）。
  - CSSは `{}` の前後を改行し、プロパティは `color: red;` のように `:` の後にスペースを入れる。
- CodePreview 内で参照する画像は `images` マップで仮想パス→実パスを渡す（Markdown/MDX の相対パス参照とは別）。
  - 仮想パスは `img/...` のようにページ内の `img/` 配下を基準にする。
  - 実パスは `import ... from "./img/..."` した値を使う。
- 複数プレビューで同じ初期コードを共有したい場合は `sourceId` を使う。
  - `sourceId` は衝突を避けるため、ページ内で一意になる短い文字列を推奨（ASCIIでなくても可）。
- 表示制御: `htmlVisible`, `cssVisible`, `jsVisible`, `previewVisible` で各パネルを切り替える。
- 完成イメージ（動作プレビュー）は、原則としてコードパネルを非表示にしてプレビューだけ見せる（`htmlVisible={false}` / `cssVisible={false}` / `jsVisible={false}` / `previewVisible={true}`）。
- 学習者が実装する CodePreview は、原則として共有を無効化する（`share={false}`）。

## 演習（@metyatech/exercise）

- `@metyatech/exercise/client` の `<Exercise>` と `<Solution>` を使用する。
  - `<Solution>` は必ず同一 `<Exercise>` の末尾に配置する。
- タイトル採番: `演習N` / `演習-発展N` を基本とし、後ろに括弧で説明を付けてよい（例: `演習1（?）`、`演習-発展1（?）`）。ページ内で重複や飛び番を作らない。
- 問題文は曖昧さを避け、開始データ・手順・確認方法・完成イメージを明示する（短く書く）。
- 問題文にヒントを入れるのは可。ただし解答に直結するコード/手順/値など「直接的な答え」は書かない（必要なら `<Solution>` 側へ移す）。
- 解答コードは `<Solution>` 内に置き、説明は初学者向けに短く具体的に書く。
- 見た目を作成する演習では、完成イメージを視覚的に提示する（プレビュー表示、提示コード内コメントなど、最も理解しやすい方法を選ぶ）。

### 演習・演習-発展の配置方針

- 各トピックごとに「演習」と「演習-発展」をこまめに配置し、学習直後に実践できるようにする（資料末尾にまとめて配置しない）。
- 「演習」は最低限知っておくべき内容までを目安にし、必要なら複数配置してよい。
- 「演習-発展」はより高いレベルの内容とし、全体を通して後半ほど難易度を上げる（複数配置してよい）。
- 本質的に同じ内容の演習を繰り返さず、多角的な出題にする。

### 演習問題の内容方針

- **演習**: 学習トピックの習得にのみフォーカスし、関係のない不要な要素を含めない。
- **演習-発展**: より実践的でもよいが、学習トピックを中心に習得できる問題にする。

### 演習作成時の既習事項確認と重複回避

演習・演習-発展を作成する際は、必ず以下の手順を踏むこと:

1. **既習事項の確認**: 上記「既習事項の扱い」に従い、未習の API / 構文を使わない設計になっていることを確認する。
2. **既出演習内容の確認**: 同一ページ内および過去ページで既に出題された演習内容を確認する。「表面的な違い」ではなく「本質的な違い（学習ポイント・解法パターン）」があるかで判断する。
3. **本質的重複の判定**: 同じイベント・同じ操作パターン・同じ学習ポイントの組み合わせは「本質的に同じ」とみなす。異なる観点（状態管理、複数イベント、条件分岐、累積変化、複数要素連動など）を持つ問題を作る。
4. **実現可能性確認**: 既習事項のみで解けることを確認する。未習事項が必要／冗長な繰り返しだけになる場合は再設計する。

## テスト・試験（評価問題）

- 設問は1つの解釈・1つの正解になるように、初期状態・操作回数・期待結果を明示する。
- 「切り替わる」など曖昧な語は、状態遷移（例: クリックのたびにトグル／1回目のみ変化）を文章で固定する。
- UI操作を問う設問は、動作イメージ（GIF/静止画）を問題文内に提示して期待動作を固定する（可能なら解答デモを再現してキャプチャ）。
- 穴埋め問題は、答えの形式（値/単位/セレクタ/プロパティ名など）と禁止事項を明示する。
- 外部システムと連携する穴埋めは `${答え}`（複数解は `${/正規表現/}`）の形式で示し、別形式（例: `【1】`）へ置換しない。
- 複数解を許容する場合は、許容範囲（例: `textContent`/`innerText` どちらでも可）を問題文に明記する。

### 自動採点に対応した試験問題（Markdown で作成すること）

以下の規約は「自動採点ツールがそのまま再利用できる最小限」に限定する。

#### 1) 試験メタ（ファイル先頭の frontmatter）

- 必須キー: `examId`, `schemaVersion`, `timeLimitMinutes`, `totalPoints`, `questionCount`
- `examId` は年度や学期を含む一意なID（例: `js2-2026-2-final-regular`）
- `schemaVersion` は `exam-md@1` など固定文字列

#### 2) 設問の見出し

- 各設問は `## 問N` で始める（Nは1始まりの連番）
- CSVの `qN/answer` との対応は、この `N` を使って自動対応する（個別IDは付与しない）

#### 3) 採点基準は必ず「表」で記載

Rubric表は必須。列名は以下に固定する。

- `criterionId`（設問内で一意）
- `points`（数値）
- `description`（学生向けの達成条件）
- `gradingMode`（採点モード）

`gradingMode` の許容値:

- `manual`（手動採点。未採点として扱う）
- `fill`（穴埋め自動採点。設問内の `${...}` から期待値を取得してOK/NG判定）

このリポジトリの自動採点ツールは、言語依存の静的解析を前提にしない。
そのため、**自動採点できるのは `fill` のみ** とし、`manual` は **未採点（要レビュー）** とする。

`fill` の自動採点は、設問本文のどこかにある `${...}` を期待値として扱う（CSSに限らない）。
`${/正規表現/}`（例: `${/transform|all/}`）の形式は正規表現一致、それ以外は文字列一致。
Rubric表の `fill` 行の順序（1行目、2行目…）と、`${...}` の出現順（1個目、2個目…）を対応付ける。
`fill` 行数と `${...}` 個数が一致しない場合はエラーとし、試験Markdownを修正する。

#### 3-1) 禁止事項

- `gradingMode` の許容値は `manual` / `fill` のみ（それ以外はエラー）。
- 自動採点は `fill` のみ。`manual` を自動採点対象にしない。

#### 3-2) 自動採点フロー（運用）

- 自動採点は `fill` のみをOK/NG判定する。
- `manual` および `fill` のNGはAIレビュー対象として抽出する。
- AIレビュー結果は `decisions.csv` に保存し、人間が最終確認する。
- 点数はRubricの `points` を唯一の参照元とし、`finalStatus` のみで確定する。

#### 4) Rubric表の位置

- 各設問内の「採点基準・配点」節にRubric表を置く（箇条書きは使わない）
- 解答と解説は必須（学生に配布するため）

#### 5) 書式例（テンプレート）

以下の例を基準にする（最小構成）。

```markdown
---
examId: js2-YYYY-2-final-regular
schemaVersion: exam-md@1
timeLimitMinutes: 80
totalPoints: 80
questionCount: 4
---

## 問1

問題文。

HTML:

```html
<!-- ここにHTML -->
```

CSS:

```css
/* ここにCSS */
```

**要件：**

- 要件を箇条書きで明確にする

### 採点基準・配点

| criterionId    | points | description                          | gradingMode |
| -------------- | ------ | ------------------------------------ | ----------- |
| q1.button.get  | 3      | ボタン要素を取得できている           | manual      |
| q1.text.get    | 3      | テキスト要素を取得できている         | manual      |
| q1.event.click | 5      | クリックイベントを設定する記述がある | manual      |
| q1.text.update | 3      | テキストを変更する記述がある         | manual      |
| q1.requirement | 2      | 要件通り動作する                     | manual      |

### 解答

```js
// 解答例
```

### 解説

解説本文。

---

## 問2

問題文。

### 採点基準・配点

| criterionId     | points | description                          | gradingMode |
| --------------- | ------ | ------------------------------------ | ----------- |
| q2.title.get    | 3      | タイトル要素を取得できている         | manual      |
| q2.content.get  | 3      | コンテンツ要素を取得できている       | manual      |
| q2.event.click  | 5      | クリックイベントを設定する記述がある | manual      |
| q2.class.toggle | 5      | クラスを付け外しする記述がある       | manual      |
| q2.requirement  | 2      | 要件通り動作する                     | manual      |

### 解答

```js
// 解答例
```

### 解説

解説本文。

#### 6) 例外

- ルールにない独自フォーマットを導入しない（解析不能になる）
- ルール変更が必要な場合は、先に本ルールへ追記してから問題を作る

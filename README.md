# course-docs-site

Shared site runtime (Next.js + Nextra) for multiple course content repositories.

## Content sync

This repo does **not** store course content in Git. The `content/` directory is synced from a public content repo
at build/dev time.

`site.config.ts` is also synced (generated) and is intentionally gitignored.

Required env vars (files or environment):

- `COURSE_CONTENT_SOURCE`
  - GitHub format: `github:owner/repo#ref` (example: `"github:metyatech/javascript-course-docs#master"` in `.env` files)
  - Local path format: `../path-to-content-repo`

Optional env vars:

- `NEXT_PUBLIC_WORKS_BASE_URL` (e.g. `https://metyatech.github.io/programming-course-student-works`)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `ADMIN_MODE_TOKEN` (server-only, the human-entered admin code)
- `ADMIN_SESSION_SECRET` (server-only, HMAC-SHA256 signing key for the admin session cookie)

The Supabase variables are only needed when the selected course enables the `/submissions` experience backed by
`@metyatech/course-docs-platform`. At the moment, that means `programming-course-docs`. They are not required for
`javascript-course-docs`.

### Admin mode

If the synced `site.config.ts` defines `adminMode.protectedLinks` (or the active site enables admin comment
moderation), two server-only environment variables are required to actually unlock admin features:

- `ADMIN_MODE_TOKEN`: the human-entered code shown in the admin-mode UI on the footer. The server compares it
  against this value at login time using a constant-time digest comparison. The token is **never** reused as
  the cookie signing secret.
- `ADMIN_SESSION_SECRET`: the HMAC-SHA256 signing key for the signed admin session cookie. The cookie is set
  after a successful `ADMIN_MODE_TOKEN` check and is verified on every protected request.

Both values must be set in production. The two values **must not be the same** — using the same value for both
would let anyone who learns the user-entered code forge valid session cookies. When the two values are equal,
`isAdminModeConfigured()` returns false, the `/api/admin/mode` endpoint reports
`unavailableReason: "admin-token-must-differ-from-session-secret"` with `configured: false`, and any `POST` to
`/api/admin/mode` returns `503` without issuing a session cookie. `ADMIN_SESSION_SECRET` must be
at least 32 bytes of UTF-8 randomness; anything shorter disables the configured admin-mode gate (the
`/api/admin/mode` endpoint reports `invalid-admin-session-secret` and the admin footer shows the setup hint).
Generate one with:

```sh
openssl rand -base64 32
```

Only `programming-course-docs` and `open-campus-unreal-90min` actually need these admin secrets — they are the
two sites that define admin capabilities (comment moderation / protected docs). The other four supported sites
(`course-common-docs`, `javascript-course-docs`, `web-foundations-docs`, `teacher-profile-docs`) have no admin
features, so they do not need `ADMIN_MODE_TOKEN` or `ADMIN_SESSION_SECRET`.

The issued session cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/`, and expires after 8 hours. The cookie
value is `<base64url(payload)>.<base64url(hmacSha256(payload, key))>`; only the HMAC key needs to stay secret.
The client stores nothing in `sessionStorage` or `localStorage`; the cookie alone gates access. Local preview
of protected pages also requires both values in `.env.local`; otherwise the footer can accept a code input, but
the protected routes will remain locked and show a setup hint.

See `.env.example` for the full list.

### Private course content authentication (Site CI)

Site CI checks out the course content for every site in `config/course-sites.json` over the GitHub API.
Most sites are public, but a small number (currently `metyatech/teacher-profile-docs`) are private.
To allow Site CI to read private content repositories, register a GitHub Actions repository secret:

- Secret name: `COURSE_CONTENT_READ_TOKEN`
- Token type: **fine-grained Personal Access Token**
- Repository access: **Only select repositories** → `metyatech/teacher-profile-docs`
- Repository permissions:
  - `Contents`: **Read-only**
  - `Metadata`: **Read-only**
- Token value: NEVER store it in `.env`, `.env.local`, `.env.example`, or any tracked source file. The token
  only ever lives in GitHub Actions repository secrets.
- When the secret is registered, Site CI exposes it to the relevant jobs as `GH_TOKEN`. A per-matrix
  preflight step validates that the secret is present for any site whose manifest entry sets
  `requiresContentReadToken: true`; if the secret is missing, the build fails fast with a clear error.
- When the secret is NOT registered, the `teacher-profile-docs` build fails at the "Validate private
  content read token" preflight step, so the overall Site CI run reports failure. Do not merge the PR
  while CI is failing. Register `COURSE_CONTENT_READ_TOKEN`, re-run CI, and confirm all 11 jobs succeed
  (11/11) before merging.

#### How is the secret handled?

The PAT is delivered to the spawned Git process by `scripts/sync-course-content.mjs` and is never
written to a file. The design has three independent isolation layers, applied only when `GH_TOKEN`
is set (the public path skips all of them):

- The PAT is **not** URL-embedded. `git ls-remote` and `git clone` always receive the canonical
  `https://github.com/<owner>/<repo>.git` URL.
- The PAT is delivered to the spawned process as an `http.https://github.com/.extraheader`
  Authorization header via the `GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_0` + `GIT_CONFIG_VALUE_0`
  triple, where `VALUE_0` is `AUTHORIZATION: basic <base64(x-access-token:PAT)>`. The base64 value
  is computed at spawn time and never written to disk.
- The spawned Git process runs with `cwd` set to a fresh empty tmpdir under `os.tmpdir()`. With no
  `.git/` in the cwd, no `includeIf.gitdir:` rule from the workspace's `.git/config` (or any
  leftover from `actions/checkout`) can match.
- **Triple-isolation of Git config sources** (added in the private-git-config-isolation pass): the
  `GIT_CONFIG_GLOBAL` env var is REPLACED with an EMPTY tmpfile under `os.tmpdir()` (so Git's
  global config is a file we control, not the user's `~/.gitconfig`); `GIT_CONFIG_NOSYSTEM=1` is
  set so Git does not read `/etc/gitconfig`; and `GIT_CONFIG_SYSTEM` is pointed at the
  OS-specific null device (`NUL` on Windows, `/dev/null` elsewhere) so any code path that
  ignores `GIT_CONFIG_NOSYSTEM` still reads an empty file. The tmpfile and tmpdir are both
  removed in `disposeIsolatedGitAuthContext` after the spawn returns.
- The inherited parent env is explicitly scrubbed of every Git override
  (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, the multi-value
  `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` family matched by pattern) before the isolated
  triple is installed. (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, and `GIT_CONFIG_NOSYSTEM` are
  installed by the auth context, not scrubbed.)
- The raw GitHub credential env vars `GH_TOKEN` and `GITHUB_TOKEN`
  (`SCRUBBED_GIT_CREDENTIAL_ENV_KEYS`) are deleted from the spawned Git process's env copy. The PAT
  reaches Git **only** inside the `GIT_CONFIG_VALUE_0` Authorization header — never as a raw
  `GH_TOKEN` (which Git credential helpers / `gh`-aware subprocesses could read) and never as a
  competing `GITHUB_TOKEN` (the PR-scoped Actions token, which could otherwise shadow the
  content-read PAT). The scrub operates on the spawned env copy only; `process.env.GH_TOKEN`
  survives so the failure-output redactor can still scrub it.
- The real-git regression test `tests/git-auth-context.test.mjs` verifies the triple-isolation
  by spawning `git config --get-all http.https://github.com/.extraheader` with the isolated env
  and asserting that exactly one Authorization header survives, with no `BADBASIC` contribution
  from a seeded `~/.gitconfig` or `XDG_CONFIG_HOME/git/config`. The test is skipped when the
  `git` binary is not on PATH.
- After every successful `git clone` (and on existing-clone reuse) the `normalizeOriginUrl`
  helper in `scripts/git-origin-normalize.mjs` defensively rewrites `<cloneDir>/.git/config` so
  that EVERY `[remote "origin"]` section's `url =` line is removed and the canonical
  `https://github.com/<owner>/<repo>.git` URL is written as exactly one `url =` line in the
  first origin section (or appended as a new section if none exists). `fetch =` lines, other
  remote sections (e.g. `[remote "backup"]`), and unrelated config keys are preserved. After
  the rewrite, the helper re-reads the file and asserts a postcondition (exactly one canonical
  `url =` line under any origin section, zero `x-access-token:` anywhere, zero `@github.com`
  userinfo in any origin URL value) so a failed repair throws an error that mentions only the
  canonical URL — never the original (potentially credentialed) value. The real-git regression
  test `tests/git-origin-normalize.test.mjs` covers the multi-`url =`-in-one-section,
  credentialed-first-then-canonical, two-origin-sections, fetch-only, no-section, and
  backup-section-preserved cases.
- `git ls-remote` stdout is parsed by `parseLsRemoteObjectId` in `scripts/git-remote-ref.mjs`,
  which enforces a strict SHA-1 (40 hex) or SHA-256 (64 hex) object-id grammar on the first
  non-blank line. Empty stdout throws `Unable to resolve remote ref ... from <canonical>`;
  malformed stdout (a first non-blank line that does not match `<hex>{40,64}\s+<ref>`) throws
  `Unable to parse remote ref ... from <canonical>` BEFORE the script attempts `git clone`.
  Both error messages use the canonical URL and never embed the malformed line. The unit test
  `tests/git-remote-ref.test.mjs` covers empty / blank-only / null input, valid 40-hex and
  64-hex lines, mixed-case hex, short / long / off-by-one hex, non-hex characters, and
  missing whitespace separators.
- User-visible command labels and exception messages are run through `redactArgsForError` and
  `redactGitError` in `scripts/sanitize-git-error.mjs`, so a failed Git invocation never echoes a
  token, an authed URL, an `Authorization: basic <b64>` value, a percent-encoded token, or an
  `x-access-token:` prefix.
- The `resolveRemoteHeadSha` error messages use the canonical URL for both
  `Unable to resolve remote ref` and `Unable to parse remote ref`, never the credentialed URL.
- On the public path (no `GH_TOKEN`) none of the above isolation is installed: the canonical URL,
  the inherited env, and the project-root `cwd` are used as-is.

#### How does the sync stay in step with the remote?

`scripts/sync-course-content.mjs` records the synced state in
`.course-content/active-source.txt` as `repo:<owner>/<repo>#<ref>@<headSha>`. The clone is reused
**only** when the full active source id — repo, ref, **and** the resolved head SHA — is unchanged:

- After `git ls-remote` resolves the current head SHA, the script builds the full
  `activeSourceId` and re-clones whenever it differs from the persisted `previousSourceId` (or no
  clone exists). A head SHA change for the **same** repo/ref still forces a fresh clone, because
  `git ls-remote` only reads the remote SHA — it never updates an existing clone's working tree.
  Reusing the clone on a SHA change would leave stale content on disk while `active-source.txt`
  advanced to the new SHA.
- Before any network access, the script repairs or removes the existing clone: if
  `previousSourceId` matches the current repo/ref, `normalizeOriginUrl` rewrites any leftover
  credentialed origin URL to the canonical form first; if it names a different repo/ref (or no
  state was recorded), the clone directory is removed outright. Either way a credentialed
  `.git/config` from a prior run can never be observed after the network step.
- `active-source.txt` is written **only after a successful clone**. If `git ls-remote` resolves a
  new SHA but the re-clone fails, the script throws before persisting the new id, so the recorded
  SHA never advances past content that is actually on disk.

#### How is the secret scoped in CI?

The secret is **never** placed at job level. `.github/workflows/ci.yml` splits the consumer steps
in `build-course` and `e2e-course` into a public variant (no `env:` block, gated on
`!matrix.requiresContentReadToken`) and a `(private content)` variant
(`env: { GH_TOKEN: ${{ secrets.COURSE_CONTENT_READ_TOKEN }} }`, gated on
`matrix.requiresContentReadToken`):

- Split steps in `build-course`: `Typecheck`, `Build (verified)`.
- Split steps in `e2e-course`: `Typecheck`, `Build (verified)`, `Run course E2E (CI)`.

The public matrix element never sees the secret, and the private matrix element sees the secret
only on the few steps that actually need it. The `npm ci`, `actions/checkout`, and
`actions/setup-node` steps never see the secret. Every `actions/checkout@v6` keeps
`persist-credentials: false`, so the PR-scoped `GITHUB_TOKEN` is never written to the local
`.git/config` as a competing `http.https://github.com/.extraheader`.

#### Regression tests

Eight test files guard this design against regression:

- `tests/sync-course-content-origin-url-normalize.test.mjs` uses the real `git` binary to create a
  throwaway repo, set `remote.origin.url` to a credentialed URL, run the production
  `normalizeOriginUrl` helper, and then verify that `git remote get-url origin` returns the
  canonical URL and that the on-disk `.git/config` no longer contains the credentialed form. (The
  new import path for `normalizeOriginUrl` is `../scripts/git-origin-normalize.mjs`; the
  re-export from `scripts/sync-course-content.mjs` remains for backward compatibility but the
  helper itself has moved to its own file.)
- `tests/sync-course-content-failure-redaction.test.mjs` uses a fake `git` to fail
  `ls-remote` and `clone` (exit 128 with stderr carrying the literal token, the percent-encoded
  form, an authed `https://...@github.com/...` URL, and an `Authorization: basic <b64>` header),
  then asserts that no token-shaped content appears in the parent process's stdout, stderr, or
  exception message. The malformed-`ls-remote` scenario also asserts that the strict
  `parseLsRemoteObjectId` parser rejects the malformed line BEFORE the script attempts
  `git clone`, so the fake-git's log file does NOT contain a `clone` argv line and the
  `Unable to parse remote ref` exception reaches the parent stderr.
- `tests/sync-course-content-private-remote-auth.test.mjs` exercises the private path
  end-to-end: it asserts that `git ls-remote` and `git clone` receive the canonical URL (no
  token in argv, no `x-access-token:` prefix, no `@github.com` userinfo), that the
  triple-isolated `GIT_CONFIG_GLOBAL` (empty tmpfile under `os.tmpdir()`),
  `GIT_CONFIG_NOSYSTEM` (`1`), and `GIT_CONFIG_SYSTEM` (OS null device) env vars are installed,
  that the spawned Git env has `GH_TOKEN` and `GITHUB_TOKEN` unset while `GIT_CONFIG_VALUE_0`
  is set (the PAT lives only in the Authorization header) even though the parent set both raw
  credential env vars, and that a stale seeded `~/.gitconfig` extraheader does NOT leak through.
- `tests/sync-course-content-remote-cache.test.mjs` uses a fake `git` to drive four sequential
  runs and asserts the clone-reuse contract: an initial cold clone, reuse on an unchanged
  repo/ref/SHA, a forced re-clone (with content body + `active-source.txt` advancing and the Next
  dist dir cleared) when the head SHA changes for the same repo/ref, and a re-clone on a ref
  switch. It counts `clone` / `ls-remote` invocations and verifies the synced content body and
  `active-source.txt` per run.
- `tests/sync-course-content-pre-network-repair.test.mjs` uses a fake `git` to prove the
  pre-network safety contract on the real on-disk `.git/config`: a matching existing clone has
  its credentialed origin repaired by `normalizeOriginUrl` BEFORE `ls-remote` (canonical config
  survives a subsequent `ls-remote` exit 128, no clone attempted); a different-source or
  unknown-state clone is deleted before `ls-remote`; and a failed re-clone after a new resolved
  SHA does NOT advance `active-source.txt`.
- `tests/git-auth-context.test.mjs` (real-git, skipped when no `git` on PATH) verifies the
  `createIsolatedGitAuthContext` / `disposeIsolatedGitAuthContext` /
  `buildScrubbedIsolatedEnv` helpers in isolation: it asserts the authEnv shape, the
  empty-tmpfile disposition, the env scrubbing against a fixture base env, and the
  triple-isolation via `git config --get-all` with seeded stale `~/.gitconfig` and
  `XDG_CONFIG_HOME/git/config` files.
- `tests/git-origin-normalize.test.mjs` (real-git) exercises the new multi-section,
  multi-`url =`-line behavior of `normalizeOriginUrl`: multiple `url =` lines in one origin
  section (canonical + credentialed, credentialed + canonical), two `[remote "origin"]`
  sections in the same file, fetch-only origin sections, no-section append, and a separate
  `[remote "backup"]` section that must be preserved.
- `tests/git-remote-ref.test.mjs` (pure unit, no I/O) covers the strict
  `parseLsRemoteObjectId` parser: empty / blank-only / null input, valid 40-hex (SHA-1) and
  64-hex (SHA-256) lines, mixed-case hex, short / long / off-by-one hex, non-hex characters,
  missing whitespace separators, and the `kind: "empty"` / `kind: "ok"` /
  `kind: "malformed"` return shapes.

Add or rotate the secret with:

```sh
gh secret set COURSE_CONTENT_READ_TOKEN --repo metyatech/course-docs-site
```

## Local development

```sh
npm install
COURSE_CONTENT_SOURCE="github:metyatech/javascript-course-docs#master" npm run dev
```

To preview local, unpushed content changes:

```sh
COURSE_CONTENT_SOURCE=../javascript-course-docs npm run dev
```

When `COURSE_CONTENT_SOURCE` points to a local directory, `npm run dev` mirrors
that repo's `content/`, `public/`, and `site.config.ts` into this app as real
files. Source edits are watched and resynced automatically without restarting
the dev server. The source repo itself is never linked into this working tree.

### Using `.env.course.local` (recommended)

Keep secrets in `.env.local` and put only course selection variables in `.env.course.local`.
`npm run dev` watches `.env(.local)` and `.env.course(.local)` and will restart the dev server when the course
selection changes.

Example `.env.course.local`:

```dotenv
COURSE_CONTENT_SOURCE=../programming-course-docs
```

Template: `.env.course.local.example`

If your selected course defines `siteConfig.adminMode.protectedLinks`, also set `ADMIN_SESSION_SECRET` in
`.env.local` before `npm run dev`.

PowerShell example:

```powershell
Set-Location -LiteralPath .\course-docs-site
$env:COURSE_CONTENT_SOURCE = '..\javascript-course-docs'
npm run dev
```

### Tutorial Shot Editor

When `COURSE_CONTENT_SOURCE` points to a **local** course content repository,
the site exposes a local-only screenshot authoring surface at
`/dev/tutorial-shots`.

If the site is currently running against a remote repo, or against a different
local course repo, the editor can temporarily switch to another local content
repo from its own setup screen without restarting dev. That override affects
only the editor. Normal docs pages still follow `COURSE_CONTENT_SOURCE`.

Use it when a tutorial page already contains a page-local tutorial image
reference such as `Action img="./img/...webp"` or an older PNG reference that
should migrate to the static UI WebP output policy:

- raw screenshot
- crop
- box / arrow / short label annotations
- generated page-local WebP output image for static UI screenshots, with animated WebP raw uploads preserved as animated WebP

The editor also warns when the scanned page still uses `<Section>` without
declaring `authoringMode: tutorial`, so local fixtures and in-progress course
repos surface page-mode drift in the same repo where the stricter platform
enforcement now runs.

See [Tutorial Shot Editor](./docs/tutorial-shot-editor.md) for the architecture,
canonical files, and authoring rules.

## Build

```sh
COURSE_CONTENT_SOURCE="github:metyatech/programming-course-docs#master" npm run build
```

## E2E test matrix

The full course Playwright matrix is an explicit heavy local command, not the
default test or pre-commit path. Run it only when you intentionally want E2E
coverage across every supported course content source:

```sh
npm run test:e2e:matrix
```

`npm run verify:e2e:matrix` is an alias for the same full local matrix.

Behavior:

- Runs E2E once with `programming-course-docs`
- Runs E2E once with `javascript-course-docs`
- Runs E2E once with `open-campus-unreal-90min`
- Uses the same E2E suite in every run
- Injects course-specific behavior by generating `tests/e2e/.suite-config.json` per course
- Cleans `tests/e2e/.suite-config.json` and leftover worktree dev/test processes before and after each course
- Fails with a nonzero exit code when a course run fails or exceeds `E2E_MATRIX_COURSE_TIMEOUT_MS`
- Logs the course name, source, port, and timeout for each matrix run
- Uses one source variable per course:
  - `E2E_PROGRAMMING_CONTENT_SOURCE`
  - `E2E_JAVASCRIPT_CONTENT_SOURCE`
  - `E2E_OPEN_CAMPUS_CONTENT_SOURCE`
- Source format:
  - Remote GitHub: `github:owner/repo#ref`
  - Local path: `../path-to-content-repo`
- Local content sources are mirrored as real files, so switching course repos inside the E2E matrix does not reuse stale linked content.

Recommended files:

- `.env.e2e`: default shared matrix settings (tracked)
- `.env.e2e.example`: local-path example template

Local example (`.env.e2e.example`):

```dotenv
E2E_PROGRAMMING_CONTENT_SOURCE=../programming-course-docs
E2E_JAVASCRIPT_CONTENT_SOURCE=../javascript-course-docs
E2E_OPEN_CAMPUS_CONTENT_SOURCE=../open-campus-unreal-90min
```

Remote example:

```dotenv
E2E_PROGRAMMING_CONTENT_SOURCE="github:metyatech/programming-course-docs#master"
E2E_JAVASCRIPT_CONTENT_SOURCE="github:metyatech/javascript-course-docs#master"
E2E_OPEN_CAMPUS_CONTENT_SOURCE="github:metyatech/open-campus-unreal-90min#main"
```

## Verification

There are three verification tiers. Pick the smallest tier that proves the
change you are making.

### `npm run verify:precommit` — fast pre-commit gate

```sh
npm run verify:precommit
```

This is the command the Husky `pre-commit` hook runs. It executes
`lint` + `test`. `npm test` runs the fast contract/unit subset via
`test:fast`; it does not start the dev-server route tests, run the production
build, execute `scripts/test-e2e-matrix.mjs`, or iterate the full course
Playwright matrix.
`npm run verify` is kept as a tooling-compatible alias for this same local
gate.

Use `npm run test:shared` when you need the heavier shared local suite that
includes dev-server-backed route/editor flows without running the full course
matrix.

### `npm run verify:ci` — CI-equivalent for one course

```sh
COURSE_CONTENT_SOURCE="github:metyatech/javascript-course-docs#master" \
  npm run verify:ci
```

This is the exact command the GitHub Actions `verify-course` matrix runs for
each course. It first runs the high-severity dependency audit gate, then builds
the site for the configured `COURSE_CONTENT_SOURCE`, and then runs
`verify:course:ci` (CI Playwright config). Use it when you need to reproduce a
CI matrix failure locally, or when validating changes that affect
course-specific build, security-audit, or E2E behavior. CI runs this command
once per course content source; reproduce a specific matrix entry by setting
`COURSE_CONTENT_SOURCE`, `COURSE_DOCS_NEXT_DIST_DIR=.next-test`, `E2E_PORT`,
and `PLAYWRIGHT_MAX_FAILURES` to match the workflow.

### `npm run test:e2e:matrix` — explicit full local E2E matrix

```sh
npm run test:e2e:matrix
```

Use this heavy tier only when you intentionally want local Playwright E2E
coverage across all supported course content sources. It auto-selects a free
local `E2E_PORT` when none is configured, isolates each course's Next dist
dir, and cleans deterministic matrix state before and after each course. Set
`E2E_MATRIX_COURSE_TIMEOUT_MS` to override the per-course timeout.

## Documentation

- [Authoring Modes](./docs/authoring-modes.md)
- [Tutorial Shot Editor](./docs/tutorial-shot-editor.md)
- [LICENSE](./LICENSE)
- [SECURITY.md](./SECURITY.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [CHANGELOG.md](./CHANGELOG.md)

## Notes

- This repo is intentionally framework-only. All course-specific text/content lives in the content repos.
- The Vercel deployment workflows live in the content repos and call the Vercel CLI against this repo.
- After a successful `CI` run on `main`, GitHub Actions in this repo automatically triggers `deploy-vercel.yml`
  in the content repos so production sites pick up the latest shared runtime.
- Cross-repo workflow dispatch uses the `COURSE_CONTENT_REDEPLOY_TOKEN` Actions secret in this repository.
- `@metyatech/course-docs-platform` is pinned in `package.json` / `package-lock.json`, so platform-only changes
  do not reach production until this repo updates the pinned commit and `main` passes `CI`.
- Content repos should use the two-mode authoring boundary documented in
  [Authoring Modes](./docs/authoring-modes.md): **Tutorial** for sequential
  build/do flows, **Non-tutorial** for explanation/reference pages.

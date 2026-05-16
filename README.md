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
- `ADMIN_MODE_TOKEN` (server-only, shared admin token for comment deletion and admin-mode unlock)

The Supabase variables are only needed when the selected course enables the `/submissions` experience backed by
`@metyatech/course-docs-platform`. At the moment, that means `programming-course-docs`. They are not required for
`javascript-course-docs`.

If the synced `site.config.ts` defines `adminMode.protectedLinks`, `ADMIN_MODE_TOKEN` is the single shared
admin code for both protected pages and admin comment deletion.
Local preview of those protected pages also requires `ADMIN_MODE_TOKEN` in `.env.local`; otherwise the footer
can accept a code input, but the protected routes will remain locked and show a setup hint.

See `.env.example` for the full list.

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

If your selected course defines `siteConfig.adminMode.protectedLinks`, also set `ADMIN_MODE_TOKEN` in
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

Run E2E against both course contents:

```sh
npm test
```

Behavior:

- Runs E2E once with `programming-course-docs`
- Runs E2E once with `javascript-course-docs`
- Uses the same E2E suite in both runs
- Injects course-specific behavior by generating `tests/e2e/.suite-config.json` per course:
  - `enableSubmissions=true` for `programming-course-docs`
  - `enableSubmissions=false` for `javascript-course-docs`
  - `codePreviewPath=/docs/html-basics/introduction` for `programming-course-docs`
  - `codePreviewPath=/docs/basics/array-intro` for `javascript-course-docs`
- Uses one source variable per course:
  - `E2E_PROGRAMMING_CONTENT_SOURCE`
  - `E2E_JAVASCRIPT_CONTENT_SOURCE`
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
```

Remote example:

```dotenv
E2E_PROGRAMMING_CONTENT_SOURCE="github:metyatech/programming-course-docs#master"
E2E_JAVASCRIPT_CONTENT_SOURCE="github:metyatech/javascript-course-docs#master"
```

## Verification

There are two canonical verification commands. Pick the one that matches what
you are trying to confirm.

### `npm run verify:precommit` — local fast gate

```sh
npm run verify:precommit
```

This is the command the Husky `pre-commit` hook runs. It executes
`lint` + `test` + `build:verified` against your current
`COURSE_CONTENT_SOURCE` (typically a local course content checkout via
`.env.course.local`). It does **not** iterate the full remote course matrix,
so commits stay fast while still catching lint, type, unit, and build
regressions against the course content you are actively working on.

### `npm run verify:ci` — CI-equivalent for one course

```sh
COURSE_CONTENT_SOURCE="github:metyatech/javascript-course-docs#master" \
  npm run verify:ci
```

This is the exact command the GitHub Actions `verify-course` matrix runs for
each course. It builds the site for the configured `COURSE_CONTENT_SOURCE`
and then runs `verify:course:ci` (CI Playwright config). Use it when you
need to reproduce a CI matrix failure locally, or when validating changes
that affect course-specific build or E2E behavior. CI runs this command once
per course content source; reproduce a specific matrix entry by setting
`COURSE_CONTENT_SOURCE`, `COURSE_DOCS_NEXT_DIST_DIR=.next-test`, `E2E_PORT`,
and `PLAYWRIGHT_MAX_FAILURES` to match the workflow.

The matrix E2E harness auto-selects a free local `E2E_PORT` when none is
explicitly configured, so verification does not fail just because another
local Next dev server is already using the default Playwright port. Set
`E2E_PORT` yourself only when you need a fixed port for a specific run.

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

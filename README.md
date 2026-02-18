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
- `ADMIN_DELETE_TOKEN` (server-only)

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

### Using `.env.course.local` (recommended)

Keep secrets in `.env.local` and put only course selection variables in `.env.course.local`.
`npm run dev` watches `.env(.local)` and `.env.course(.local)` and will restart the dev server when the course
selection changes.

Example `.env.course.local`:

```dotenv
COURSE_CONTENT_SOURCE=../programming-course-docs
```

Template: `.env.course.local.example`

PowerShell example:

```powershell
Set-Location -LiteralPath .\course-docs-site
$env:COURSE_CONTENT_SOURCE = '..\javascript-course-docs'
npm run dev
```

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

Run the full verification suite (typecheck and tests):

```sh
npm run verify
```

## Documentation

- [LICENSE](./LICENSE)
- [SECURITY.md](./SECURITY.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [CHANGELOG.md](./CHANGELOG.md)

## Notes

- This repo is intentionally framework-only. All course-specific text/content lives in the content repos.
- The Vercel deployment workflows live in the content repos and call the Vercel CLI against this repo.

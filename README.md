# course-docs-site

Shared site runtime (Next.js + Nextra) for multiple course content repositories.

## Content sync

This repo does **not** store course content in Git. The `content/` directory is synced from a public content repo
at build/dev time.

Required env vars:

- `COURSE_CONTENT_REPO` (e.g. `metyatech/javascript-course-docs`)
- `COURSE_CONTENT_REF` (optional, default: `master`)

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
COURSE_CONTENT_REPO=metyatech/javascript-course-docs npm run dev
```

## Build

```sh
COURSE_CONTENT_REPO=metyatech/programming-course-docs npm run build
```

## Notes

- This repo is intentionally framework-only. All course-specific text/content lives in the content repos.
- The Vercel deployment workflows live in the content repos and call the Vercel CLI against this repo.

# course-docs-site

Shared site runtime (Next.js + Nextra) for multiple course content repositories.

## Content sync

This repo does **not** store course content in Git. The `content/` directory is synced from a public content repo
at build/dev time.

Required env vars:

- `COURSE_CONTENT_REPO` (e.g. `metyatech/javascript-course-docs`)
- `COURSE_CONTENT_REF` (optional, default: `master`)

## Local development

```sh
npm install
COURSE_CONTENT_REPO=metyatech/javascript-course-docs npm run dev
```

## Build

```sh
COURSE_CONTENT_REPO=metyatech/programming-course-docs npm run build
```


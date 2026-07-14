# @metyatech/course-docs-platform

`packages/platform` はCourse Docs monorepo内の内部workspace packageです。実行可能なNext.js/Nextra
siteはrepository rootにあり、このpackageは複数course siteで共有するMDX、Next.js、submission機能を提供します。

## Purpose

`course-docs-platform` holds the shared runtime and authoring building blocks that are reused across course sites.
変更はroot siteとの境界をまたぐ場合も、同じmonorepo commitで行います。

Primary consumers:

- `course-docs-site` (direct)
- Course content repositories such as `javascript-course-docs` and `programming-course-docs` (indirect via `course-docs-site`)

## What this provides

- Shared Next/Nextra integration helpers, including MDX remark plugins and webpack asset rules
- Shared MDX and runtime features, such as exercise rendering, code preview wiring, submissions UI, and admin routes
- Shared MDX syntax checks and tutorial component linting for Course Docs Site authoring

## Requirements

- Node.js `>=20`
- npm

## Development

monorepo rootから実行します:

```powershell
npm ci
npm run platform:build
npm run platform:verify
npm run platform:pack:check
```

## Documentation

- [docs/admonition-authoring.md](./docs/admonition-authoring.md)
- [Root LICENSE](../../LICENSE)
- [Root SECURITY](../../SECURITY.md)
- [Root CONTRIBUTING](../../CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)

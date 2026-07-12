# course-docs-platform

Reusable platform package for metyatech course documentation sites.

## Purpose

`course-docs-platform` holds the shared runtime and authoring building blocks that are reused across course sites.
Use this repository when a change should apply to multiple course sites instead of a single content repository.

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

Install dependencies:

```bash
npm install
```

Run the full verification suite:

```bash
npm run verify
```

Useful commands:

- `npm run build`
- `npm run test`
- `npm run lint`
- `npm run typecheck`

## Documentation

- [docs/admonition-authoring.md](./docs/admonition-authoring.md)
- [LICENSE](./LICENSE)
- [SECURITY.md](./SECURITY.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CHANGELOG.md](./CHANGELOG.md)

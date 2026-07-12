# Contributing

Thank you for your interest in contributing to this project!

## Development Process

1. Fork the repository.
2. Create a new branch for your changes.
3. Implement your changes and add tests if applicable.
4. Run the fast local gate before committing: `npm run verify:precommit`.
   The Husky `pre-commit` hook runs this command automatically; invoking it
   manually mirrors what the hook will do.
5. To reproduce what GitHub Actions runs for a single course, set
   `COURSE_CONTENT_SOURCE` and run `npm run verify:ci`. CI runs this same
   command once per matrix entry (`javascript-course-docs`,
   `programming-course-docs`, `open-campus-unreal-90min`).
6. Run the explicit full local E2E matrix only when your change needs local
   Playwright coverage across every supported course: `npm run test:e2e:matrix`.
7. Submit a pull request.

## Verification commands

| Command                    | Tier                           | When to run                                                               | What it does                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify:content`   | Synced-content quality gate    | Every time you edit synced MDX / assets locally or before pushing content | Site-owned verifier that inspects root `content/` for Exercise heading rules and four-space code-block / asset indentation. `_meta.ts` is excluded from the asset rule and is left to the source repo's formatter; see [docs/content-quality-boundary.md](./docs/content-quality-boundary.md). Wired into `typecheck` / `build` / `build:verified` immediately after `sync:content`. |
| `npm run verify:precommit` | Fast pre-commit                | Every commit (auto via Husky)                                             | Local fast gate: `lint` + `test`; `npm test` runs `test:fast`, not dev-server route/editor flows or the full matrix.                                                                                                                                                                                                                                                                 |
| `npm run verify:ci`        | CI-equivalent single course    | Reproducing a CI matrix failure locally                                   | Same command CI runs per course: high-severity dependency audit gate, then `build`, then `verify:course:ci` for the current `COURSE_CONTENT_SOURCE`.                                                                                                                                                                                                                                 |
| `npm run test:e2e:matrix`  | Explicit full local E2E matrix | Intentional all-course local E2E runs                                     | Heavy Playwright matrix across all supported course content sources with per-course cleanup and timeout.                                                                                                                                                                                                                                                                             |

`verify:precommit` deliberately does not iterate the full remote course matrix.
The CI `verify-course` job fans out across course content sources and runs
`verify:ci` for each one, so any commit that passes `verify:precommit` locally
is still subject to the full matrix in CI. `npm run verify` remains a
tooling-compatible alias for `npm run verify:precommit`, and
`npm run verify:e2e:matrix` remains an explicit alias for the full local E2E
matrix.

## Rules

- Follow the existing code style and conventions.
- Add descriptive commit messages.
- Ensure all relevant tests pass before submitting.
- `npm run verify:precommit` is the local default. `npm run verify:ci` is
  reserved for reproducing CI failures and is the single canonical command
  the GitHub Actions `verify-course` job runs.
- `npm run test:shared` is the heavier shared local suite for route/editor
  checks that need dev servers; keep it outside the pre-commit gate.
- `npm run test:e2e:matrix` is the explicit full local E2E matrix command; do
  not add it back to `npm test` or the pre-commit gate.

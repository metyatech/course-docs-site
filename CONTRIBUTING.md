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
6. Submit a pull request.

## Verification commands

| Command                    | When to run                             | What it does                                                                                              |
| -------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run verify:precommit` | Every commit (auto via Husky)           | Local fast gate: `lint` + `test` + `build:verified` against your current `COURSE_CONTENT_SOURCE`.         |
| `npm run verify:ci`        | Reproducing a CI matrix failure locally | Same command CI runs per course: `build` then `verify:course:ci` for the current `COURSE_CONTENT_SOURCE`. |

`verify:precommit` deliberately does not iterate the full remote course matrix.
The CI `verify-course` job fans out across course content sources and runs
`verify:ci` for each one, so any commit that passes `verify:precommit` locally
is still subject to the full matrix in CI.

## Rules

- Follow the existing code style and conventions.
- Add descriptive commit messages.
- Ensure all tests pass before submitting.
- `npm run verify:precommit` is the local default. `npm run verify:ci` is
  reserved for reproducing CI failures and is the single canonical command
  the GitHub Actions `verify-course` job runs.

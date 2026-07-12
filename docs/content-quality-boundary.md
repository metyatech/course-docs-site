# Content Quality Boundary

This document describes the boundary between **teaching-material / learner-facing code quality** and **source / control-file formatting quality** in the Course Docs Site stack.

Course Docs Site syncs course content from external content repositories into a local `content/` mirror. The mirror is then verified, typechecked, and built. The verifier and the source repository's own formatter both run on the same files, but they are answering different questions and they MUST stay separate.

## Two contracts, three layers

| Layer                                   | Lives in                                                                              | What it owns                                                                                                                   | Example files                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Site runtime source                     | `course-docs-site/src/**`, `course-docs-site/scripts/**`, `course-docs-site/tests/**` | This repository's own formatter / lint / typecheck / build gates                                                               | `src/lib/foo.ts`, `scripts/verify-content.mjs`                        |
| Synced learner-facing teaching material | `content/**` (the synced mirror)                                                      | The `verify-content` four-space code-block / asset gate, Exercise heading rules, and the learner-facing MDX component contract | `content/docs/<course>/index.mdx`, `content/docs/<course>/example.ts` |
| Synced Nextra control metadata          | `content/**/_meta.ts`                                                                 | The source content repository's own Prettier / lint / typecheck gates                                                          | `content/_meta.ts`, `content/docs/_meta.ts`                           |

The boundary is the `_meta.ts` file name. Files with that exact name under `content/` are **Nextra control metadata** and follow the source-repo formatter contract. Everything else under `content/` that is a code asset (`.css`, `.html`, `.js`, `.json`, `.ts`) follows the `verify-content` learner-code contract.

## What is the `verify-content` gate for?

`scripts/verify-content.mjs` enforces the **learner-facing teaching-material** quality contract on the synced `content/` mirror:

- **Exercise heading rules** — every `<Exercise>` opening tag must be immediately preceded by a Markdown heading (`###` through `######`), allowing only blank lines between them, and must not carry a `title` prop. This is a course-docs authoring contract from `course-docs-platform`.
- **Code-block / asset indentation** — fenced code in `html / css / js / jsx / json / ts / tsx / typescript` blocks and standalone `*.css / *.html / *.js / *.json / *.ts` assets under `content/` MUST use spaces and four-space indentation steps.

The four-space rule exists because learners read and copy the snippets. A consistent indentation width keeps the rendered output and the copy-paste result aligned across all courses. It is a **teaching-material** quality contract, not a code-quality contract.

## What is the source-repo formatter for?

Each content repository (`<course>-course-docs`) owns the formatting of its own source files. The source repository may use its own formatter settings, such as Prettier with a 2-space JavaScript / TypeScript tab width, and those settings are intentionally independent from the learner-facing four-space gate. The source repository's own CI / pre-commit hooks run:

- `prettier --check`
- `eslint`
- `tsc --noEmit`

These gates are the **authoritative formatter** for source-side files, including `content/**/_meta.ts`. They run on the source repository, on the source-side paths, before the content ever reaches the synced mirror.

## Why is `_meta.ts` excluded from the four-space rule?

Nextra reads `content/**/_meta.ts` at the site runtime to configure sidebar / page labels and ordering. `_meta.ts` is a **control file**, not learner-facing code:

- Learners never read it.
- Learners never copy it.
- It is not a teaching example.

If the four-space rule applied to `_meta.ts`, the source repository would have to either:

1. Fork the source formatter so that `_meta.ts` gets a 4-space tab width while the rest of the source tree keeps its normal settings, or
2. Carry a `_meta.ts`-specific formatter override (e.g. an override keyed on the file name) so only control metadata follows the site verifier's learner-code indentation rule.

Both options leak the site runtime's teaching-material contract into a content repository. They couple the source repo to a constraint that exists only because of how a downstream site reads its files. The cleaner contract is:

- The source repo formats `_meta.ts` with its own formatter (Prettier / ESLint / tsc).
- The site verifier leaves `_meta.ts` alone, because the four-space rule is about learner-facing code, not about control metadata.

## What happens when a `_meta.ts` is broken?

The verifier does not check `_meta.ts`. The source repository's own gates are responsible for catching:

- syntax errors (TypeScript typecheck),
- Prettier formatting drift (`prettier --check`),
- ESLint violations (`eslint`).

A broken `_meta.ts` typically shows up as a Nextra build error or as a missing sidebar entry at site runtime, not as a `verify-content` failure. That is intentional: a failure in control metadata should be diagnosed by the source repository's source-code quality gates, not by a teaching-material gate that lives in a different repository.

## What is still caught by `verify-content`?

- 2-space fenced code in MDX code blocks of any supported language.
- Tab-indented fenced code or tab-indented asset files.
- 2-space standalone `.css`, `.html`, `.js`, `.json`, `.ts` assets under `content/` — including ordinary `.ts` files such as `content/docs/<course>/example.ts` that learners may read or copy.
- `<Exercise>` tags without a preceding heading.
- `<Exercise>` tags with a `title` prop.
- Unterminated `<Exercise>` opening tags.

`_meta.ts` is the only file name that is excluded from the asset-indentation check. The exclusion is **path-scoped to `content/**`** and is intentionally narrow: any future `\*.ts` asset that learners will see is still caught.

## How to read the boundary in CI

When you see a `verify-content` failure, treat it as a teaching-material defect: a learner will read the broken snippet. Fix it in the source content repository.

When you see a Prettier / ESLint / tsc failure in a content repository, treat it as a source-code defect: the file may or may not be learner-facing. Fix it in that source repository.

When you see a Nextra build error caused by `_meta.ts`, fix it in the source content repository. The site verifier will not have flagged it, by design.

## Summary

| Concern                                                       | Gate                                       | Lives in                         |
| ------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| Learner-facing code readability (indentation, tabs vs spaces) | `verify-content` four-space rule           | `course-docs-site`               |
| `<Exercise>` authoring shape                                  | `verify-content` heading / title-prop rule | `course-docs-site`               |
| Source-repo formatting (Prettier)                             | `prettier --check`                         | content repository               |
| Source-repo linting (ESLint)                                  | `eslint`                                   | content repository               |
| Source-repo type safety (tsc)                                 | `tsc --noEmit`                             | content repository               |
| Nextra control metadata shape                                 | TypeScript / Nextra build                  | source repository + site runtime |

# Authoring Modes

Use **two authoring modes only** for Course Docs Site content:

- **Tutorial**: the learner follows a sequence of actions to reach a concrete end state.
- **Non-tutorial**: the learner mainly reads, understands, or looks something up.

Do **not** introduce a large page-type taxonomy. The system needs a clear
authoring boundary, not a complex classification scheme.

## Core Rule

Classify a page by its **primary learner job**, not by the components it
currently happens to use and not by the repository it lives in.

Ask one question first:

> If the learner stops reading after the first half of the page, have they
> mostly been **following steps** or mostly been **building understanding**?

- If the page is mainly sequential work toward a built result, treat it as a
  **Tutorial**.
- If the page is mainly explanation, overview, concept building, reference, or
  lookup, treat it as **Non-tutorial**.

## Tutorial

Choose Tutorial mode when the learner must move through the page in order and
each step depends on the previous one.

Typical examples:

- environment setup
- software installation
- building a sample project
- operating an unfamiliar GUI
- debugging or recovery flows with ordered steps

Tutorial pages should use the tutorial-authoring structure from
`@metyatech/course-docs-platform` and be reviewed against the tutorial
principles.

## Non-tutorial

Choose Non-tutorial mode when the page's main value is understanding or
reference rather than step execution.

Typical examples:

- introductions and overviews
- concept explanations
- glossaries and reference pages
- summaries and recap pages
- policy pages

Non-tutorial pages can still contain short local procedures, but those
procedures stay subordinate to the page's explanatory job.

## Allowed Local Mixing

Some local mixing is correct.

These are allowed:

- a Tutorial page contains short concept or reference blocks needed for the
  next action
- a Non-tutorial page contains one short procedure that clarifies a concept
- a concept page ends with a short exercise that checks understanding

These are **not** allowed:

- a page that is equally trying to be a long explanation and a full hands-on
  walkthrough
- a page whose main flow keeps switching between "read this background" and
  "now follow these many steps" without one dominant job
- a page that requires the learner to jump between tutorial and reference
  reading modes every few paragraphs

When that happens, the page should be **split or rebuilt**, not labeled with a
third page type.

## Split Criteria

Split a page when one or more of these are true:

- the page has two different success conditions
- the learner would reasonably want to revisit only one half later
- the page has a long ordered workflow plus a long standalone explanation
- the tutorial part would be clearer if it started closer to the first action
- the explanation part would be clearer if it did not have to carry step-by-step
  operational detail

## Migration Policy

When reviewing existing course content, sort each page into one of three
outcomes:

1. **Keep as Tutorial**
   The page's primary job is sequential execution and should be migrated into a
   clean tutorial structure.
2. **Keep as Non-tutorial**
   The page's primary job is explanation or reference and should stay in normal
   MDX prose.
3. **Split / Rebuild**
   The page currently mixes tutorial and non-tutorial jobs strongly enough that
   neither mode is clear.

This review must be done **by page content and learner job**, not by the
legacy system the page was originally written in.

## System Implication

Course Docs Site should keep the authoring boundary lightweight:

- no user-facing multi-type UI
- no large page-type taxonomy
- one clear distinction between Tutorial and Non-tutorial
- existing exam/question flows remain separate

If stricter enforcement is needed later, prefer a **lightweight tutorial opt-in
or tutorial-structure-based enforcement** over a broad `pageType` enum.

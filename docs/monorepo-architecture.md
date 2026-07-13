# Course Docs monorepo architecture

`course-docs-site` is the single Course Docs monorepo. The runnable Next.js/Nextra application remains at the
repository root; it is not an application nested under `apps/`.

## Responsibilities

- The root application owns content synchronization, site composition, deployment wiring, development tooling,
  end-to-end tests, and integrated verification.
- `packages/platform` owns the internal `@metyatech/course-docs-platform` workspace package: shared MDX
  components, remark/rehype configuration, webpack asset rules, reusable Next app factories/routes, and shared
  course-site behavior.

The dependency direction is **root application → `@metyatech/course-docs-platform`**. The npm package name is
stable even though its source lives at `packages/platform` in this repository.

## Change boundaries

Platform and site changes that cross this boundary are committed and verified together in one commit and PR.
Course content repositories remain separate, content-only repositories: do not move the Next.js runtime back to
them. Do not add implementation to the archived `metyatech/course-docs-platform` repository, and do not add it
as an external Git dependency, submodule, or subtree synchronization source.

# Static v2 pilot implementation brief

> Status: **approved first implementation milestone**
>
> Audience: the next implementer of Learning System v2.
>
> This document is the handoff contract for the first implementation. Read it together with
> `README.md`, `schema.md`, `box-model-reference.md`, and
> `implementation-architecture.md`.

## Why this milestone exists

The long-term v2 design includes learner-specific state, classroom synchronization, persistent
Evidence, retrieval scheduling, Teacher View, and external-tool evaluators.

Those capabilities are intentionally **not** part of the first implementation.

The first milestone exists to answer one narrower question:

> Can the real v2 schema/compiler/Bundle/runtime architecture produce a learner experience at
> least as coherent as the box-model v6.13 reference **without** introducing identity,
> persistence, adaptation, or classroom infrastructure?

This reduction is deliberate risk control, not a change to the long-term design.

## Definition of "Static v2"

For this milestone, "static" means:

- every viewer receives the same learning content;
- every viewer follows the same compiled core path;
- teacher and learners use the same learner-facing material;
- no viewer identity is required;
- no learner-specific branch is selected;
- no learning state survives reload by requirement;
- no server-side classroom state exists.

"Static" does **not** mean "non-interactive".

Ephemeral browser state is allowed and required where it protects the instructional sequence, for
example:

- commit a prediction before seeing the result;
- remember the local submitted answer;
- reveal feedback only after submission;
- allow a local retry;
- move through the fixed lesson sequence.

Reloading the page may reset all of this state.

## Decisions that are already fixed

The next implementer should treat the following as design constraints, not reopen them merely for
implementation convenience.

### Educational model

- v2 keeps the five-model separation:
  - Knowledge;
  - Learner;
  - Evidence;
  - Task;
  - Pedagogical Policy.
- Task design follows claim -> Evidence -> Task.
- Knowledge Components are finer-grained than lesson Units.
- assisted, independent, retention, and generalization Evidence remain distinguishable.
- prediction/retrieval must not leak the answer before commitment.
- post-answer retry is not equivalent to a fresh independent attempt.
- v6.13 remains the reference experience for the CSS class-selector flow.
- learner-facing UI should avoid redundant status narration.

### Runtime architecture

- AI/Codex authors content before class; the live runtime does not invent lesson prose with an
  LLM.
- source is compiled to a validated, serializable Learning Bundle.
- the Bundle uses stable IDs and deterministic version/hash semantics.
- the Learning Engine/domain logic stays independent of React, Next.js, Supabase, and browser
  APIs.
- v2 is implemented beside v1 rather than expanding the existing v1
  `packages/platform/src/mdx/tutorial/learning-model.ts` into a mixed v1/v2 system.
- the first runtime uses a deterministic **Static Policy**.
- the renderer consumes the Bundle/IR; do not reproduce v6.13 by page-specific React hard-coding.

### First learner experience

The first accepted slice is:

```text
minimal orientation
-> predict which elements p selects
-> commit answer
-> concrete result
-> learner reasoning where useful
-> canonical explanation
-> add class="nedan" only
-> observe that appearance does not change
-> change p to .nedan
-> observe the isolated change
-> generate .waku independently
-> one fresh variation
```

The causal contrast:

```text
add class only
-> no visual change
-> change selector
-> visual change
```

is a required acceptance property.

## Explicitly out of scope

Do **not** implement any of the following in the Static v2 pilot unless this document is
deliberately revised first:

- learner login or identity;
- roster integration;
- learner-specific Learner Model state;
- adaptive routing by learner;
- private learner hints/remediation/enrichment;
- separate Presentation View;
- Teacher View;
- ClassSession;
- teacher-controlled network reveal;
- Supabase tables for learning state;
- Realtime/Broadcast/Presence;
- any other external learning-state datastore;
- localStorage/IndexedDB learning history;
- cross-device or cross-session history;
- mastery thresholds;
- retrieval scheduling;
- retention-decay algorithms;
- external object storage for Bundles;
- Unreal telemetry;
- production identity-provider decisions;
- 40-client classroom synchronization.

Existing unrelated Supabase functionality in the repository does not need to be removed. The
restriction is: **do not make the v2 pilot depend on external learning-state storage.**

## Implementation must be incremental

Do not implement the whole Static v2 pilot in one change set.

### Gate A — compile-time foundation only

Implement first:

- v2 semantic TypeScript types;
- v2 source/fixture representation;
- semantic validator;
- Learning Compiler;
- deterministic Bundle serialization/hash;
- box-model class-selector fixture;
- focused unit/contract/snapshot tests.

Do **not** add the learner-facing runtime yet.

Expected result:

```text
source fixture
  -> validate
  -> compile
  -> deterministic immutable Bundle
```

Gate A passes when:

- the same source + compiler version produces the same Bundle/hash;
- stable IDs are preserved;
- the class-selector linked contrast survives compilation;
- invalid target references fail;
- invalid variable-response Evidence that is recognition-only can be rejected/flagged according
  to the v2 validator contract;
- answer/reveal relationships needed by the reference experience are representable;
- existing v1 behavior is unchanged;
- existing repository verification remains green.

The Gate A source representation is a checked-in JSON fixture with `sourceSchemaVersion: 1`.
Its compiler emits Bundle `schemaVersion: 1` using compiler version `0.1.0`. Canonical JSON
recursively sorts object keys by Unicode code point, preserves array order, and contains no
whitespace. `bundleId` is `sha256:` followed by the lowercase SHA-256 digest of that canonical
Bundle JSON with `bundleId` omitted. The checked-in class-selector fixture and golden Bundle pin
this initial representation; they do not settle future authoring formats.

Gate A validation errors cover required structure and enums, stable IDs and duplicates, all
declared cross-references, variable-response Knowledge Components with only recognition-level
Evidence, fresh Evidence reveal gates, ungraded semantic claims for explanation responses, and
linked-contrast dimension declarations and actual value changes. Evidence sufficiency for
required rationales, pedagogical transfer adequacy, meaningful retention delay, prerequisite
confounding, debugging sufficiency, final-artifact attribution, mastery thresholds, Learner Model
inference, and Task difficulty remain deferred.

**Stop and review Gate A before implementing Gate B.**

### Gate B — shared interactive runtime

Only after Gate A review, implement:

- generic Activity renderer for the primitives needed by the reference;
- deterministic Static Policy;
- ephemeral local interaction reducer/state;
- local commit-before-reveal behavior;
- common feedback/result rendering;
- class-selector reference flow through the actual Bundle/renderer path.

No identity, database, Realtime, or adaptive learner branches.

Gate B passes when:

- teacher and learner opening the same material receive the same path;
- prediction cannot reveal the answer before local commitment;
- all content comes from Bundle/registered renderers rather than page-specific pedagogy;
- the `class="nedan"`-only state and selector-change state remain separate;
- `.waku` is generated before its answer is revealed;
- one fresh variation exists after `.waku`;
- reload may reset interaction state without breaking the page;
- v1 pages remain unaffected.

**Stop and review Gate B before expanding the pilot.**

### Gate C — complete Static box-model reference

Only after Gate B review, extend the same architecture through:

- width/height;
- border;
- padding;
- integrated content -> padding -> border relation;
- final independent practice;
- selected debugging/variation where already justified by the reference design.

Still no learner-specific or server-side learning state.

Gate C is the completion of the first user-approved "Static v2" milestone.

## Suggested code-boundary shape

Exact filenames are implementation detail, but dependency direction is not.

A reasonable first arrangement inside the existing platform workspace is conceptually:

```text
learning-v2/schema
learning-v2/compiler
learning-v2/engine
learning-v2/runtime
learning-v2/fixtures
```

The implementer may choose different names if repository conventions justify them.

Required boundaries:

- schema has no framework dependency;
- compiler is build-time/Node code;
- engine is pure TypeScript;
- runtime may depend on React/browser APIs;
- compiler/server-only modules must not enter the browser bundle;
- v1 learning-model code remains separate.

Do not create multiple workspaces/packages merely to satisfy this diagram if strong module
boundaries inside `packages/platform` are simpler for Gate A.

## Bundle requirements for Gate A

The exact final schema syntax remains intentionally open, but the first Bundle must already have
the semantics required by the long-term architecture.

At minimum the compiled artifact needs stable representation for:

- Bundle/schema/compiler identity;
- Unit/KC definitions;
- Evidence specifications used by the reference;
- Task Family/variant identity;
- linked contrast sequence;
- fixed core path / core-step identity;
- feedback/reveal gate semantics;
- learner-facing resource/activity references;
- evaluator definition sufficient for the pilot interactions.

Avoid fields whose only purpose is to imitate v1 `phase/pattern/strategy`.

If a field exists only because v1 had it, justify it from the v2 model or omit it.

## Static Policy

The first Policy is intentionally boring.

Conceptually:

```text
current compiled core step
-> next compiled core step
```

It does not inspect learner identity or history.

Local answer correctness may affect immediate feedback text/state only where the common activity
defines it, but it must not route different viewers into different lesson branches in this
milestone.

If support is shown in the pilot, it is part of one shared non-adaptive path or is a
viewer-triggered local aid available equally to everyone. It is not selected from a Learner
Model.

## Evidence in the pilot

The compiler should model intended Evidence truthfully even though there is no durable Learner
Model yet.

Runtime observations may live only in memory.

This means the implementation can validate concepts such as:

- response before reveal;
- correct/incorrect local response;
- assistance/exposure lineage during the current interaction;
- fresh variation versus same answered item.

But it must not claim:

- long-term mastery;
- retention;
- cross-session generalization;
- class-wide mastery;
- durable learner history.

The distinction is important because the first implementation should not encode shortcuts that
later make valid Evidence impossible.

## UI acceptance requirements

The implementation should be checked in an actual browser, not only through unit tests.

For the class-selector slice, capture/inspect the meaningful states:

1. prediction before response;
2. result after response;
3. `class="nedan"` added while selector is still `p`;
4. selector changed to `.nedan`;
5. `.waku` independent-generation prompt;
6. feedback/result after `.waku`;
7. fresh variation.

Review for:

- no answer leakage;
- no unnecessary status narration;
- no duplicate result sentence;
- causal changes are visually isolated;
- future content is not prematurely shown;
- prior context needed for comparison remains available;
- interaction does not feel like a quiz dashboard;
- learner-facing text remains concise;
- no teacher-only prose appears.

Passing tests is necessary but not sufficient; the actual rendered experience must satisfy the
v6.13 acceptance intent.

## What the next implementer may decide

The following can be decided during Gate A/B implementation without returning to the previous
designer, provided the fixed constraints above remain intact:

- exact v2 TypeScript type names;
- exact file/module names;
- whether authoring fixture input is YAML, JSON, or typed TS for the initial test;
- exact Content IR field names;
- exact hash canonicalization implementation;
- exact renderer component names;
- exact local reducer/state shape;
- exact test framework placement;
- whether the first fixture is generated or checked in, as long as determinism is testable.

Prefer the smallest reversible choice.

Document newly fixed semantics in `docs/learning-system-v2/` as they become real contracts.

## What must remain deferred

Do not invent placeholder answers for these just to make the pilot look complete:

- mastery numeric thresholds;
- Learner Model inference algorithm;
- retrieval scheduler;
- retention decay;
- production identity provider;
- Teacher View UX;
- persistent SQL schema;
- RLS policy;
- Bundle object-storage provider;
- Realtime channel design details beyond the existing architecture proposal;
- Unreal observation/telemetry implementation.

These belong to later milestones and should be informed by the actual implementation constraints
then.

## Repository safety / migration rules

- Keep current v1 production behavior intact during Gate A and Gate B.
- Do not migrate all course repositories.
- Do not rewrite existing content merely to prove that v2 can work.
- Use the box-model reference as the first fixture/acceptance target.
- Do not remove v1 APIs/components until v2 has explicit acceptance coverage and migration is
  separately approved.
- Backward compatibility is not a final educational requirement; temporary coexistence is a
  development-safety measure.

## Next implementer's reading order

Read these before editing:

1. `docs/learning-system-v2/static-v2-pilot.md` — current implementation scope and stop gates.
2. `docs/learning-system-v2/box-model-reference.md` — reference learner experience.
3. `docs/learning-system-v2/schema.md` — semantic model and validator requirements.
4. `docs/learning-system-v2/implementation-architecture.md` — long-term system boundaries.
5. `docs/learning-system-v2/README.md` — overall educational design and open questions.
6. `docs/learning-system-v2/research-basis.md` — evidence/provenance when a design decision is
   challenged.
7. current v1 `docs/learning-system.md` and
   `packages/platform/src/mdx/tutorial/learning-model.ts` — only to understand what must remain
   operational, not as the v2 design template.

## First task for the next implementer

Implement **Gate A only**.

Do not proceed into the learner-facing runtime in the same implementation pass.

At completion, report:

- exact changed files;
- the chosen v2 source/Bundle boundary;
- validator rules implemented versus still deferred;
- deterministic Bundle/hash test result;
- box-model class-selector fixture result;
- all focused tests;
- existing platform/repository verification results;
- confirmation that runtime behavior and v1 content rendering did not change;
- commit SHA and branch;
- any newly discovered architecture issue that should be reviewed before Gate B.

That report is the review point for deciding whether Gate B should begin.

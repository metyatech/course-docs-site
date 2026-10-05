# Learning System v2 implementation architecture

> Status: **proposed architecture / not implemented**
>
> This document translates the research-driven v2 semantic model into deployable system
> boundaries. It does not authorize production migration by itself.

## Architecture goals

The architecture must preserve these educational properties:

- teacher-controlled common pacing;
- learner-private support within a common Unit;
- delayed answer reveal for synchronized elicitation;
- immediate useful feedback where appropriate;
- evidence provenance: assistance, exposure, delay, context variation, evaluator channel;
- later retrieval and transfer;
- explainable policy decisions;
- trustworthy teacher awareness without exposing class aggregates to learners;
- v6.13-or-better learner-facing coherence.

It must also work across:

- declarative/visual lessons such as CSS;
- external GUI tools such as Unreal Engine;
- executable programming tasks such as JavaScript.

## Top-level split

v2 should be implemented as four operational layers over the five semantic learning models.

```text
Course source
    |
    v
[1] Learning Compiler
    |
    | immutable Learning Bundle
    v
[2] Learning Engine
    |
    | activity decisions / observations / state projections
    v
[3] Classroom Runtime
    |
    | Student / Presentation / Teacher views
    v
[4] Persistence + Realtime
```

Evaluator adapters cross the Engine/Runtime boundary because some evaluation happens in a browser
sandbox, some through artifact/tool inspection, and some through external integrations.

## 1. Authoring source and Learning Compiler

### Authoring remains offline / pre-class

AI agents may author rich Knowledge, Evidence, Task, and content source files.

The live classroom must not rely on an LLM to invent:

- the next explanation;
- a hint;
- a worked example;
- a misconception response;
- an assessment oracle;
- the current lesson sequence.

Those artifacts should be generated, validated, and versioned before class.

Runtime AI may be reconsidered later for narrowly bounded functions, but it is not part of the
v2 core architecture.

### Compiler input

The long-term authoring serialization remains unresolved. Gate A starts from a checked-in JSON
fixture; compiler input must be able to represent:

- Units and KCs;
- prerequisites and relations;
- Evidence specifications;
- Task Families and variation dimensions;
- evaluator specifications;
- linked contrast sequences;
- explanations / worked examples / hints / learner-facing resources;
- shared core steps and allowed private branches;
- feedback/reveal gates;
- rejoin points;
- optional/non-blocking enrichment;
- external-tool environment bindings;
- failure/recovery structures.

Content source can use YAML/JSON/MDX or another authoring format, but the runtime must not depend
on parsing arbitrary authoring syntax.

### Compiler output: Learning Bundle

The compiler emits a **serializable, immutable Learning Bundle**.

Conceptual shape:

```ts
type LearningBundle = {
  schemaVersion: number;
  compilerVersion: string;

  courseId: string;
  contentRevision: string;
  bundleId: string; // content-addressed hash

  knowledge: KnowledgeModel;
  evidenceSpecs: EvidenceSpec[];
  taskFamilies: CompiledTaskFamily[];
  activityCatalog: ActivityDefinition[];
  corePlan: CoreStepDefinition[];
  evaluatorSpecs: EvaluatorSpec[];
  resourceManifest: ResourceManifest;
};
```

The exact TypeScript shape is not frozen.

### Bundle rules

A Bundle should:

- contain only serializable runtime data;
- use stable IDs for every entity referenced by Evidence;
- include the source content revision and compiler version;
- receive a content-addressed `bundleId`;
- be validated before production build succeeds;
- be immutable once published;
- remain retrievable for active/historical sessions that reference it.

Do not make historical Evidence depend on whatever content happens to be on `main` today.

### Learning Content IR

v2 learner activities should compile to a restricted, serializable **Learning Content IR**
instead of arbitrary runtime JSX where practical.

The IR can represent approved renderable primitives such as:

- rich text;
- code;
- images;
- comparisons;
- executable previews;
- response controls;
- worked examples;
- hints;
- result visualizations.

Renderer types are registered platform capabilities. Authoring syntax may still be MDX, but the
compiler should reduce v2 learning activities to data that can be validated and versioned.

This allows an old Bundle to remain renderable after the source repository changes, provided its
IR schema version is still supported.

## 2. Learning Engine

The Engine should be **pure TypeScript domain logic** with no React, Next.js, Supabase, filesystem,
or browser dependency.

It contains:

- Pedagogical Policy;
- Learner Model projection;
- Evidence interpretation;
- Task-variant selection;
- review/retrieval scheduling interface;
- classroom step reducer;
- support escalation/fading rules.

### Deterministic policy

Given the same:

```text
Learning Bundle
Learner State
Evidence history
Class State
current Core Step
policy version
```

the Engine should produce the same decision.

Policy output should select from validated activities or deterministic Task Family variants. It
should not generate unvalidated learner-facing prose.

### Constrained adaptation

The Engine may choose:

- which validated Task variant to instantiate;
- hint/support level;
- worked example versus completion versus independent generation;
- remediation branch;
- same-Unit enrichment;
- whether later retrieval is due.

It may **not** independently move a learner into a future teacher-controlled core Unit while the
class remains on the current one.

### Policy decision record

Persist enough information to explain routing:

```text
decision ID
policy version
bundle ID
learner-state input version
class-state input version
selected activity / variant
selected support level
reason codes
```

Reason codes should be machine-readable; learner-facing explanations are not required.

## 3. Classroom Runtime

### One session, three projections

Student, Presentation, and Teacher views should be projections of one authoritative
`ClassSession`.

Conceptual session state:

```ts
type ClassSession = {
  sessionId: string;
  classId: string;
  bundleId: string;

  currentCoreStepId: string;
  corePhase: "collecting" | "discussion" | "resolved" | "practice";
  revision: number;

  status: "scheduled" | "live" | "ended";
};
```

Exact phase names are unresolved.

### Presentation View

Presentation View renders only shared learner-facing state.

It subscribes to session progression but has no access to private learner data or teacher-only
aggregates.

It never renders teacher coaching merely because Teacher View knows it.

### Student View

Student View combines:

```text
shared ClassSession core step
+ learner-specific branch decision
+ learner Evidence/state
```

A learner can temporarily diverge for a private hint/example/remediation/enrichment activity and
then rejoin the shared core step.

### Teacher View

Teacher View sees:

- session control;
- response count;
- aggregate answer/error patterns;
- support-needed counts;
- connection/response status when observable.

It should operate on aggregate/projection APIs rather than downloading all raw learner histories
to the browser by default.

### Teacher-controlled reveal

For synchronized `ELICIT` activities:

1. learners submit responses;
2. the server records attempts while session phase is still pre-reveal;
3. correctness/solution feedback may be withheld;
4. teacher optionally initiates discussion;
5. teacher releases resolution;
6. shared/student views reveal the validated result/explanation.

The server, not the client clock, determines whether the attempt was accepted before or after
answer exposure.

A post-reveal retry can be useful practice but must not automatically become fresh independent
Evidence.

### Private immediate feedback

Practice Tasks can declare immediate private feedback.

The shared Presentation View need not change when one learner receives:

- a correctness result;
- a hint;
- a worked example;
- a retry;
- enrichment.

## 4. Persistence and Realtime

### Durable truth: Postgres

Durable educational state should live in Postgres, not browser memory and not a long-lived
Vercel Function instance.

Supabase is already present in the platform and is a reasonable backend for the v2 pilot and
production architecture.

### Realtime transport: Supabase Realtime

Use Supabase Realtime primarily for low-latency notification/fan-out.

Current Supabase guidance recommends Broadcast for most database-change realtime use cases; it
also provides Presence for slow-changing online state.

Proposed channel split:

```text
session:<sessionId>:class
  core-step release
  reveal / resolve
  session ended

session:<sessionId>:teacher
  new-response notification
  aggregate-invalidated notification
  operational warnings

session:<sessionId>:learner:<learnerId>
  rare private server notification when needed
```

Do not broadcast private learner Evidence on the shared class channel.

### Database is authoritative; Realtime is not

Broadcast messages are hints that new state exists.

Every client must be able to recover by fetching the authoritative session state after:

- initial load;
- reconnect;
- detected revision gap;
- stale message;
- deployment/reload.

Messages should include monotonically increasing `session.revision` where applicable.

### Presence

Use Presence only for slow-changing operational awareness such as:

- learner currently connected;
- current shared step/page;
- possibly "working / submitted" presence state.

Do not use Presence as durable mastery storage or high-frequency telemetry.

### Why not keep classroom state in a Vercel WebSocket Function?

Vercel WebSocket support can serve bidirectional connections, but a connection is pinned to a
Function instance and durable/shared room state still requires an external store or pub/sub
layer.

Because v2 already needs durable learner Evidence and Supabase already provides Postgres plus
Realtime, keeping authoritative room state in Supabase avoids a second realtime authority.

A future transport change should not affect Learning Engine semantics.

## Persistence model

Exact SQL is unresolved, but the following logical tables/projections are recommended.

### `learning_bundles`

Immutable published bundle metadata and/or bundle object location.

Key fields:

- `bundle_id`;
- `course_id`;
- `content_revision`;
- `schema_version`;
- `compiler_version`;
- `published_at`;
- immutable object/storage reference.

### `learning_classes`

Long-lived teaching cohort.

No Evidence should require storing a learner's human-readable name directly in Evidence rows.

### `learning_class_members`

Maps a class to stable opaque learner identities and teacher-visible roster metadata.

### `learning_sessions`

Authoritative live-class state:

- `session_id`;
- `class_id`;
- `bundle_id`;
- current core step;
- core phase;
- monotonically increasing revision;
- status/timestamps.

### `learning_session_events`

Append-only teacher/session orchestration events, such as:

- session started;
- step released;
- discussion opened;
- resolution released;
- session ended.

This provides an audit/replay trail.

### `learning_attempts`

Append-only learner attempts.

Key semantics:

- globally unique idempotency ID;
- learner ID;
- session ID when applicable;
- Bundle/activity/Task/variant IDs;
- response payload according to Task capture policy;
- assistance/exposure context;
- server-accepted timestamp;
- session revision/phase at acceptance.

Do not overwrite an old attempt with a retry.

### `learning_observations`

One attempt may yield several normalized observations.

Examples:

- syntax valid;
- selected target element X;
- answer correct;
- used hint level 1;
- behavior scenario 2 failed;
- external task self-confirmed;
- compile state observed via screenshot.

Include:

- evaluator ID/version;
- observation channel;
- normalized facts;
- reliability/provenance where applicable.

### `learner_kc_state`

Derived current projection for fast Policy decisions.

It must be recomputable from durable Evidence when the inference model changes.

Store:

- learner ID;
- KC ID;
- projection/inference version;
- independent performance;
- assistance dependence;
- retention;
- generalization;
- calibration;
- misconception hypotheses where justified;
- last-updated Evidence cursor.

### `learning_review_due`

Optional derived projection for retrieval scheduling.

The exact scheduling algorithm remains unresolved and should be versioned independently.

## Append-only Evidence and projections

Canonical Evidence history should be append-only.

Derived state such as `learner_kc_state` can be updated transactionally for speed, but it is a
projection, not the historical truth.

This makes it possible to:

- improve the inference algorithm later;
- replay a learner history;
- audit why support was shown;
- distinguish historical content/policy versions;
- recover from projection bugs.

## Write path

A useful attempt write flow is:

```text
Student action
  -> local attempt ID
  -> evaluator obtains raw result
  -> POST / learning RPC
       transaction:
         read authoritative session phase/revision
         insert attempt idempotently
         insert normalized observation(s)
         update learner projection
         update review projection if needed
  -> return accepted Evidence + next private decision
  -> database trigger / server emits teacher invalidation Broadcast
```

For synchronized pre-reveal Tasks, the transaction stamps exposure from authoritative session
state.

## Offline / unstable classroom network behavior

Learner activity should not disappear because classroom Wi-Fi briefly fails.

Student Runtime should keep a small local durable outbox, preferably IndexedDB:

- create attempt UUID before sending;
- retain response/Evidence payload until acknowledged;
- retry idempotently;
- preserve original local sequence;
- show only minimal action-relevant sync state.

On reconnect:

1. refetch authoritative ClassSession;
2. resend unacknowledged attempts;
3. reconcile Policy state;
4. never convert a late post-reveal upload into pre-reveal Evidence if the server cannot establish
   the required timing.

The exact rule for genuinely offline pre-reveal attempts is unresolved; correctness claims must
prefer validity over optimistic inference.

## Identity and authorization boundary

A long-lived Learner Model requires a stable learner identity.

The core Engine must depend on an opaque `learnerId`, not on a specific login provider.

Define an `IdentityAdapter` boundary so production can use an appropriate school identity
provider without coupling pedagogy to authentication.

### Anonymous auth limitation

Anonymous Supabase users are useful for temporary sessions, but they cannot recover the same
account after signing out, clearing browser data, or moving to another device.

Therefore anonymous identity alone is not sufficient as the canonical long-term learner identity
for retention across lessons.

It may still be useful for disposable demos or a pre-login local experience.

### Data minimization

Evidence tables should use opaque learner IDs.

Human-readable roster names and external identifiers should be separated behind authorization
boundaries and exposed only where operationally necessary.

### RLS

Production persistence should use Row Level Security so:

- learners can write/read only their own permitted records;
- teachers can control only classes/sessions they own or are assigned to;
- learners cannot subscribe to Teacher View channels/aggregates;
- service-role credentials never enter the browser.

The exact identity provider remains an open decision.

## Evaluator architecture

All evaluators normalize output into one Evidence envelope.

Conceptual interface:

```ts
type EvaluationRequest = {
  bundleId: string;
  taskId: string;
  variantId: string;
  response: unknown;
  runtimeContext: unknown;
};

type EvaluationResult = {
  evaluatorId: string;
  evaluatorVersion: string;
  observations: Observation[];
  feedbackRef?: string;
};
```

### Evaluator categories

#### Structured-response evaluator

For:

- multiple choice;
- multiple select;
- exact normalized short responses;
- structured numeric answers.

#### Browser DOM/code evaluator

For JavaScript/CSS tasks in an isolated browser/iframe sandbox.

Can inspect:

- DOM state;
- event-driven state transitions;
- console/errors;
- behavior across multiple scenarios.

Do not require exact source shape unless mechanism is the target.

#### External-tool evaluator

For Unreal and similar tools.

Possible adapters:

- learner self-confirmation;
- screenshot/image evidence;
- exported artifact inspection;
- local plugin/telemetry bridge;
- teacher confirmation.

Observation channel must remain explicit.

#### Human/AI review evaluator

For evidence that cannot be reduced to reliable deterministic checks.

It should emit provenance showing that the observation was reviewed rather than pretending to be
a deterministic oracle.

## Task variants

Task variation must be reproducible.

A runtime-generated variant should record:

- Task Family ID;
- generator version;
- seed;
- realized relevant dimensions;
- realized surface dimensions;
- variant fingerprint.

This lets Evidence interpretation know what actually varied and allows a task to be reproduced
for debugging/audit.

## Feedback resources

Feedback should reference prevalidated resources or deterministic templates.

Example:

```text
Observation:
  selector missing class prefix

Policy:
  choose hint resource "class-prefix-reminder-v1"

Student View:
  render that private hint
```

Do not send raw error categories directly as learner-facing prose unless that prose itself has
been authored/reviewed.

## Retrieval scheduling

The architecture should expose a versioned `ReviewScheduler` interface.

Input:

- KC Evidence history;
- time since previous learning/retrieval;
- retention state;
- upcoming curriculum dependencies.

Output:

- due/not-due;
- desired Evidence dimension;
- candidate Task Family constraints.

The exact spacing algorithm is intentionally not fixed in this document.

## Deployment and versioning

### Session pinning

When a teacher starts a class session, pin it to one immutable `bundleId`.

A session must not silently reinterpret IDs after a new course deployment.

### Bundle retention

Published Bundles referenced by live or retained Evidence must remain retrievable.

Do not store the only copy inside an ephemeral build directory.

A practical deployment can publish Bundles to immutable object storage keyed by `bundleId`
while the application ships generic renderers for supported Bundle schema versions.

### Version fields

Persist separately:

- Bundle schema version;
- compiler version;
- Pedagogical Policy version;
- evaluator version;
- Learner Model inference version;
- ReviewScheduler version.

This avoids one global "v2.3" number hiding incompatible semantics.

## Recommended code boundaries

The exact workspace layout can change, but dependencies should point one way.

```text
learning-schema
  no framework dependencies

learning-compiler
  -> learning-schema
  Node/build-time only

learning-engine
  -> learning-schema
  pure TypeScript domain logic

learning-evaluators
  -> learning-schema
  adapters split by runtime capability

learning-runtime-react
  -> learning-schema
  -> learning-engine
  browser/UI only

learning-supabase
  -> learning-schema
  persistence/realtime adapter

Next.js app
  composes runtime + Supabase + routes
```

This can initially live as strongly separated modules inside the platform workspace if adding
multiple packages creates unnecessary migration cost. Dependency-boundary tests should prevent
compiler/server-only imports from leaking into browser bundles.

## Integration with current course-docs-site

Current pages are statically imported through Nextra/MDX, while the platform already has a
Supabase dependency for a separate submissions/comment feature.

v2 should not mutate the existing v1 `learning-model.ts` into a large mixed runtime.

Recommended migration shape:

1. leave v1 runtime operational while v2 is built behind separate entry points;
2. add v2 compiler to content verification/build;
3. compile one reference course/page into a Bundle;
4. add generic v2 Activity renderer;
5. ship the Static v2 pilot with ephemeral interaction state only;
6. validate the box-model reference experience;
7. add learner identity/adaptation only in a later milestone;
8. add durable learner state;
9. add class session/realtime and separate Presentation/Teacher projections;
10. migrate content deliberately;
11. remove v1 only after v2 acceptance criteria pass.

Backward compatibility is not an educational requirement; this temporary coexistence is an
implementation safety strategy.

## Static v2 pilot: first implementation milestone

Before introducing learner-specific state or classroom infrastructure, implement a deliberately
smaller **Static v2 pilot**.

### Scope

The pilot has exactly one shared learner-facing experience.

Teacher and learners render the same material and follow the same fixed core path.

Explicitly excluded:

- learner accounts or IDs;
- learner-specific Learner Model;
- adaptive branching by learner;
- private hints/remediation/enrichment;
- Teacher View;
- separate Presentation View;
- ClassSession persistence;
- Supabase learning-state tables;
- Realtime;
- external object storage for learning state;
- cross-device or cross-session learning history;
- retrieval scheduling;
- external-tool telemetry.

No new external data store is required for this milestone.

### Local state is allowed

"Static" does **not** mean "non-interactive".

The browser may keep ephemeral local state needed to preserve the instructional sequence, for
example:

- whether a prediction has been submitted;
- the submitted local answer;
- whether feedback/result has been revealed;
- current local retry state;
- current shared-path activity position.

Reloading the page may reset this pilot state.

Do not persist learner Evidence to localStorage/IndexedDB merely to simulate the later
persistence layer unless a narrowly scoped implementation need is demonstrated.

### Real v2 compiler, simplified runtime policy

The compile-time path must already be production-shaped:

```text
authoring/model source
    -> semantic validation
    -> Learning Compiler
    -> immutable Learning Bundle
    -> renderer
```

The runtime policy for the pilot is intentionally simple:

```text
StaticPolicy
  -> follow the authored/compiled core path
  -> same path for every viewer
```

There is no learner-specific routing.

This keeps the architecture extensible without prematurely implementing adaptive infrastructure.

### Evidence during the pilot

The semantic model may describe intended Evidence and evaluators, and interactions may compute
local correctness for feedback.

However, the pilot does not claim a durable Learner Model.

Any in-memory observation exists only to drive the current page interaction or validate the
compiler/evaluator contract.

### Reveal semantics

Because there is no synchronized ClassSession yet, teacher-controlled class reveal is deferred.

For the pilot, activities that require answer secrecy use a local interaction gate:

```text
prompt
  -> viewer commits answer/prediction
  -> local reveal becomes available
  -> common result/explanation is shown
```

This preserves the educational property "commit before answer" without pretending that 40
browsers are synchronized.

A later classroom milestone will replace the local gate with authoritative teacher-controlled
session release while keeping the same activity semantics.

### Acceptance target

The first accepted experience is the class-selector portion of the box-model reference:

```text
minimal orientation
-> p-selector prediction
-> concrete result
-> learner reasoning where useful
-> canonical explanation
-> add class only / no visual change
-> switch p to .nedan / isolated visual change
-> independent .waku generation
-> one fresh variation
```

All viewers follow this same path.

The implementation passes only if this experience is at least as coherent as the v6.13
reference and is generated through v2 schema/compiler/Bundle/renderer boundaries rather than
page-specific hard-coding.

### Pilot architecture

The first runtime therefore reduces to:

```text
Course v2 source
      |
      v
Learning Compiler
      |
      v
immutable Learning Bundle
      |
      v
Static Policy
      |
      v
shared interactive renderer
      |
      v
ephemeral browser state only
```

Persistence/Realtime remain future adapters, not hidden dependencies of the pilot.

## First vertical slice

The first executable slice should be **CSS class selector from the box-model reference**.

It should include:

- immutable compiled Bundle;
- prediction response before reveal;
- local commit-before-reveal interaction (no teacher/session synchronization yet);
- concrete result feedback;
- linked class-added-only -> selector-changed contrast;
- independent `.waku` generation;
- one fresh variation;
- one shared, non-adaptive support path where support is needed;
- ephemeral local attempt/observation representation sufficient to validate Evidence contracts;
- local answer-exposure lineage within the page interaction;
- deterministic Static Policy;
- acceptance comparison against v6.13.

Do **not** begin by implementing all Teacher View analytics, all identity providers, all retrieval
algorithms, or Unreal telemetry.

The first slice validates the architecture with the strongest existing reference experience.

## Recommended implementation sequence

### Phase A — compile-time correctness

Build:

- v2 schema types;
- compiler;
- Bundle hash/versioning;
- semantic validators;
- box-model fixture Bundle;
- snapshot/contract tests.

Exit condition: invalid KC/Evidence/Task relationships fail before runtime.

### Phase B — Static v2 interactive runtime

Build:

- Activity renderer;
- deterministic Static Policy;
- ephemeral local interaction/Evidence reducer;
- CSS class-selector reference flow;
- local commit-before-reveal gates.

Do not add learner identity, adaptive branches, browser persistence/outbox, Supabase learning
state, Realtime, or separate teacher/student projections in this phase.

Exit condition: the shared static experience matches or improves the v6.13 acceptance fixture
through the real Bundle/renderer path.

### Phase C — evaluator layer

Build:

- structured evaluator;
- DOM/code evaluator interface;
- normalized observations;
- evaluator versioning;
- exposure/assistance provenance.

Exit condition: JavaScript DOM fixture can distinguish behavior, mechanism, and failure classes.

### Phase D — durable learner state

Build:

- Postgres/Supabase schema;
- RLS;
- idempotent attempt ingestion;
- append-only observations;
- learner-state projection;
- Bundle retention.

Exit condition: learner state survives reload/device session with a stable test identity and can
be replayed from Evidence.

### Phase E — classroom orchestration

Build:

- ClassSession;
- teacher-controlled core step/reveal;
- Realtime Broadcast;
- reconnect revision reconciliation;
- Presentation View;
- Student soft synchronization;
- minimal Teacher View counts/errors.

Exit condition: a 40-client synthetic test can submit responses, receive release events, branch
privately, and rejoin without cross-learner leakage.

### Phase F — retrieval and external-tool adapters

Build:

- ReviewScheduler version 1;
- delayed retrieval queue;
- external observation adapters;
- Unreal stateful Task support;
- richer Teacher View.

Exit condition: later-session retrieval and Unreal procedure fixture both produce correctly
provenanced Evidence.

## Acceptance tests

Architecture tests should include at least:

### Bundle determinism

Same source revision + compiler version -> same Bundle hash.

### Stable history

Publishing a new Bundle does not change interpretation of old attempt references.

### Reveal integrity

An attempt accepted after teacher release cannot be marked pre-reveal independent Evidence.

### Idempotency

Retrying an attempt POST with the same attempt ID creates no duplicate Evidence.

### Learner isolation

Student A cannot read Student B private response/support state.

### Presentation isolation

Presentation View cannot retrieve Teacher View aggregates or learner-private records.

### Realtime recovery

Dropped Broadcast + reconnect converges by fetching authoritative session revision.

### Branch/rejoin

A learner in remediation rejoins when teacher releases the next core step while unmet Evidence
remains recorded.

### Evaluation semantics

Behaviorally equivalent code passes when behavior is the target; mechanism shortcuts fail only
when the mechanism is explicitly targeted.

### v6.13 reference

The novice class-selector flow remains at least as coherent as the recorded v6.13 fixture.

## Deliberately unresolved implementation choices

The architecture does not yet fix:

- the production identity provider;
- exact SQL column names and indexes;
- Bundle object-storage provider;
- final Content IR serialization;
- exact policy/inference algorithms;
- exact review scheduler;
- exact Teacher View visuals;
- whether a future trusted external-tool bridge runs locally, in the browser, or through a
  separate service.

Those choices can be made without changing the five-model architecture if the boundaries above
are preserved.

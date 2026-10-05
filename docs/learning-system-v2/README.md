# Learning System v2 design

> Status: **proposed / not implemented**
>
> This directory records the design target for the next Course Docs learning system.
> The current production contract remains [`../learning-system.md`](../learning-system.md).

## Purpose and priority

Course Docs v2 optimizes first for learner outcomes that can be justified from the best available
research, not for backward compatibility with v1 or ease of manual authoring. Content is expected
to be produced primarily by AI agents, so a richer internal schema is acceptable when it improves
instructional reasoning, validation, evidence quality, or learner experience.

The normative educational purpose remains: learners should enjoy learning with a positive
outlook while increasing what they can actually do, and become increasingly independent in
thinking, judging, building, solving, and continuing to learn.

## Classroom target

Primary target:

- roughly 40 learners;
- teacher-led whole-class instruction;
- teacher presents Course Docs on a shared screen and advances the class;
- learners may also use their own Course Docs session;
- large-scale pace remains common;
- support can adapt per learner inside the current Unit;
- later lessons can revisit weak or aging knowledge.

Central synthesis:

> **Teacher-controlled common pacing + active learning + real-time formative evidence +
> bounded individual adaptation + later retrieval and transfer.**

A fully self-paced course is not the default architecture.

## Three views

### Presentation View

The teacher's shared learner-facing display.

- Show only information useful to learner activity and understanding.
- Do not show teacher instruction prose such as "ask students to discuss now".
- Do not expose internal labels such as `ELICIT`, `RESOLVE`, or `GUIDED`.
- Teacher-only icons are unnecessary by default; the activity UI should make the natural
  classroom action apparent.
- Before peer discussion, do not reveal class answer distributions that can bias later answers.

### Student View

The same current core step as Presentation View, plus a private support layer when needed.

Possible additions:

- hints;
- worked examples;
- completion scaffolds;
- remediation;
- extra practice;
- same-Unit enrichment or variation.

This is **common content + private support**, not an independently paced course.

### Teacher View

Not shared with learners. Its purpose is teacher awareness.

Useful information may include:

- answered / total;
- response or correctness distribution;
- common error or misconception clusters;
- learners who have not responded;
- learners currently needing support.

Prefer concise information over prose telling the teacher what to do when the evidence itself is
sufficient.

## Soft synchronization

The classroom uses **soft synchronization**.

1. **Synchronized core step**
   - prediction;
   - conceptual question;
   - shared observation;
   - teacher-controlled reveal;
   - common explanation or resolution.
2. **Bounded individual branch**
   - hint;
   - worked example;
   - remediation;
   - additional practice;
   - same-Unit enrichment.
3. **Rejoin point**
   - teacher releases the next common core step;
   - all learners rejoin even if their private branch differed.

Learners who have not yet produced sufficient evidence are not left permanently on an earlier
page. Unmet evidence remains in the Learner Model and can trigger later remediation, retrieval,
or prerequisite support.

Learners who finish early do not automatically start the next Unit. They broaden or deepen the
same KC through variation, contrast, debugging, or reasonable transfer.

> **Pace is teacher-controlled; support is individualized.**

## Pedagogical state machine

Candidate internal states:

- `ORIENT`
- `ELICIT`
- `SUPPORT / MODEL`
- `DISCUSS`
- `RESOLVE`
- `GUIDED`
- `INDEPENDENT`
- `DEBUG`
- `RETRIEVE`
- `TRANSFER`
- `REMEDIATE`

These are internal states, not learner-facing labels and not mandatory MDX components.

A common path is:

```text
ORIENT
  -> ELICIT
  -> SUPPORT / MODEL or DISCUSS when needed
  -> RESOLVE
  -> GUIDED
  -> INDEPENDENT
```

Later evidence may use:

```text
RETRIEVE -> TRANSFER
```

Insufficient evidence can route through `REMEDIATE`.

The policy should not mechanically use every state. Simple fixed factual knowledge may need
concise instruction, retrieval, feedback, and later spaced retrieval rather than elaborate
self-explanation or discovery.

For ConceptTest-style Peer Instruction, research supports discussion when initial responses are
meaningfully divided. Reported percentage ranges from that literature are context-specific and
must not become universal thresholds for every Course Docs task.

## Five core models

1. **Knowledge Model** — What should be learned?
2. **Learner Model** — What does this learner currently appear able to do?
3. **Evidence Model** — What observations would support a learning claim?
4. **Task Model** — What task can elicit those observations?
5. **Pedagogical Model / Policy** — What should happen next?

The runtime also supplies **Class State** to Pedagogical Policy.

Design direction:

```text
Knowledge claim
    -> required Evidence
    -> Task
    -> learner Observation
    -> Learner Model update
    -> Pedagogical Policy
    -> next Task / shared step
    -> ...
```

Do not design a task first and then retroactively invent what it supposedly measures.

See [`schema.md`](./schema.md).

## Unit versus Knowledge Component

A **Unit** is a curriculum or lesson-level grouping.

A **Knowledge Component (KC)** is a finer-grained piece of knowledge or skill whose state can be
inferred across multiple tasks.

v2 should not require authors to choose a superficial category such as `fact`, `concept`,
`procedure`, or `principle`. Instructional requirements should instead be derived from KC
characteristics such as condition variability, response variability, verbal/performance form,
rationale, and prerequisites.

## Learner Model dimensions

At minimum, keep these dimensions distinguishable:

- independent performance / mastery;
- assistance dependence;
- retention strength;
- generalization / transfer;
- metacognitive calibration.

Optional state can include:

- misconception hypotheses when systematic errors justify them;
- temporary session or affect state when useful.

Do not collapse the evidence history into one opaque mastery percentage. A numerical estimate may
exist, but the system should retain enough evidence to explain why a learner was given a
particular support or task.

## Evidence strength

Assisted and independent success are not equivalent.

Conceptual ordering:

```text
success with support
    -> independent success in familiar conditions
    -> independent success under meaningful variation
    -> delayed independent retrieval
    -> delayed independent success under changed conditions
```

This is not a universal numeric scale.

## Task Families

Prefer **Task Families** over unrelated one-off questions.

A Task Family explicitly represents which dimensions are:

- relevant to the target KC;
- surface details;
- varied to test generalization;
- contrastive or diagnostic.

This permits controlled generation of:

- same-context practice;
- contrast cases;
- near variation;
- delayed retrieval;
- transfer tasks.

Changing names, values, or decorative details alone must not automatically count as transfer.

## Debugging

Debugging is not a simple KC category. It is a complex task/activity family that can integrate
several KCs.

Useful observable stages:

```text
observe symptom
    -> localize failure
    -> form hypothesis
    -> test hypothesis
    -> repair
    -> verify repair
```

A final program that happens to work is not sufficient evidence of debugging competence when
diagnosis and verification were not observed.

## Relationship to v1

The following v1 metadata is **not assumed to survive unchanged as author-fixed v2 metadata**:

- `initial / practice / retrieval / transfer`;
- `instruction-first / problem-solving-first`;
- `productive-failure`.

In v2, at least part of this should be derivable from KC characteristics, Task characteristics,
Learner Model, evidence history, elapsed time, and Class State.

This is a proposed design direction, not a production migration.

## Reference experience

The CSS box-model prototype v6.13 is a **reference experience / acceptance fixture** for v2.

For:

```text
novice learner + css-class-selector + no prior evidence
```

the generated v2 experience should be at least as coherent and learner-friendly as v6.13.
If a new abstraction makes that experience worse, change the model rather than degrading the
reference experience.

See [`box-model-reference.md`](./box-model-reference.md).

A procedure-heavy Unreal Engine stress test is recorded in
[`unreal-procedure-reference.md`](./unreal-procedure-reference.md). It confirms that the same
five-model architecture can cover external-tool procedures, provided Task and Evidence models
represent environment state, action sequences, observation channels, and recovery paths.

An executable-code stress test is recorded in
[`javascript-dom-reference.md`](./javascript-dom-reference.md). It confirms that the same
architecture can also cover code generation, runtime behavior, DOM state, events, automated
semantic evaluation, and programming-specific debugging.

## Provenance

Use these labels where the distinction matters:

- `R` — supported in the same direction by multiple independent studies or research syntheses
  within relevant boundary conditions;
- `S` — Course Docs-specific synthesis from research-supported premises;
- `L` — local, normative, product, or platform decision;
- `U` — unresolved by available evidence.

See [`research-basis.md`](./research-basis.md).

## Implementation architecture

The proposed runtime/compiler/persistence boundaries are documented in
[`implementation-architecture.md`](./implementation-architecture.md).

The central implementation rule is that AI authors content **before class**, while the live
runtime executes a deterministic, validated Learning Bundle. The runtime may select activities,
variants, support, and feedback timing, but it should not depend on an LLM inventing lesson
content during instruction.

## Open questions / not yet fixed

Do not silently freeze these without further work:

- exact class-progression threshold;
- exact mastery probability or score threshold;
- exact retrieval scheduling algorithm;
- exact retention decay/update model;
- exact Learner Model inference algorithm;
- exact Task difficulty model;
- exact schema serialization syntax;
- exact Teacher View UI;
- exact persistence, authentication, and session architecture;
- exact small-group orchestration policy;
- whether and how confidence is collected without unnecessary friction;
- how AI-generated KC decomposition is revised from real learner error data.

## Non-goals of this snapshot

This directory does not:

- change runtime behavior;
- define new React components;
- migrate MDX;
- replace `learning-model.ts`;
- implement validators;
- migrate course repositories;
- change `learning-units.yaml`;
- deploy anything;
- guarantee backward compatibility.

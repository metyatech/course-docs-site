# Unreal procedure-heavy reference

> Status: **v2 stress-test reference / not implemented**
>
> Source material: the current `metyatech/open-campus-unreal-90min` student guide, especially
> the BP_JumpPad mission. This document does not modify that course. It tests whether the proposed
> Learning System v2 can represent a procedure-heavy external-tool lesson.

## Why this stress test matters

The CSS box-model reference is dominated by visible conceptual contrasts and code generation.

The Unreal lesson adds different demands:

- GUI navigation;
- stateful project/artifact editing;
- multi-step action sequences;
- execution and data-flow connections;
- compile state;
- play-test verification;
- recovery from partially correct states;
- screenshots and version-dependent UI;
- learner actions that Course Docs may not be able to observe directly.

A valid v2 architecture must handle these without forcing every procedure into a text-answer
model.

## Representative target: build a jump pad

The existing lesson asks the learner to:

1. place `BP_JumpPad`;
2. inspect its `Collision` component;
3. add `On Component Begin Overlap (Collision)`;
4. use `Other Actor` with `Cast To Character`;
5. connect `As Character` to `Launch Character`;
6. set the launch Z value and Z Override;
7. compile;
8. play-test;
9. verify that the character is launched upward;
10. diagnose the graph if the behavior fails.

This is a strong test because a correct final behavior depends on both conceptual and procedural
knowledge.

## Candidate Knowledge Components

The exact decomposition remains revisable, but a plausible model includes:

### Editor / procedure KCs

- `ue-place-actor`
  - place an existing Blueprint actor in a level and position it;
- `ue-add-component-overlap-event`
  - add the appropriate begin-overlap event for a selected component;
- `ue-blueprint-execution-connect`
  - connect execution pins so operations run in the intended order;
- `ue-blueprint-object-data-connect`
  - connect the relevant object/data output to the intended input;
- `ue-compile-and-check`
  - compile a Blueprint and interpret success/failure status;
- `ue-playtest-verify-behavior`
  - execute an appropriate play test and verify the intended behavior.

### Concept / relation KCs

- `ue-overlap-other-actor-meaning`
  - understand that `Other Actor` is the actor entering the Collision;
- `ue-cast-character-purpose`
  - understand why Character-specific processing should continue only when the actor can be
    treated as a Character;
- `ue-launch-character-target`
  - understand that the Character reference is the launch target;
- `ue-launch-velocity-z-relation`
  - understand that the Z component controls the vertical launch component in this task;
- `ue-blueprint-execution-flow`
  - understand the role of execution connections;
- `ue-blueprint-data-flow`
  - understand the role of data/object connections.

The Task may integrate several KCs, but final success must not automatically mark all of them
mastered.

## Reference instructional flow

| Stage | Shared learner experience | Main purpose / Evidence | Adaptation |
| --- | --- | --- | --- |
| Goal preview | Show the desired jump-pad behavior, not the finished graph. | Orientation. | None required. |
| Baseline test | Place or use the pad and confirm it does not launch yet. | Establish initial state; causal baseline. | Recovery for placement/navigation only. |
| Collision inspection | Select the Collision and see its detection region. | Ground the event source in a visible object. | Screenshot cue when needed. |
| Event model | Explain that entering the Collision can trigger a begin-overlap event. | `ue-overlap-other-actor-meaning` foundation. | Extra visual explanation if needed. |
| Guided event creation | Demonstrate the UI path for adding the first overlap event; learner performs it. | Assisted procedure Evidence. | Full screenshot sequence for novices. |
| Result check | Verify the event node exists for the intended Collision. | Outcome Evidence for the guided step. | Recovery if wrong component/event. |
| Other Actor reasoning | Identify what object should be checked when something enters the Collision. | Concept Evidence before wiring. | Contrast player versus unrelated actor. |
| Guided Cast | Add `Cast To Character` from `Other Actor`. | Procedure + data-flow Evidence. | Less UI detail if pin-drag/search mechanic is already known. |
| Launch target reasoning | Determine what should be launched after successful cast. | Target/data relationship. | Worked visual if needed. |
| Faded node creation | Add `Launch Character` from `As Character` with less click-by-click support than the first node. | Procedural fading. | Restore detailed screenshots if learner stalls. |
| Vertical parameter | Introduce or retrieve X/Y/Z relation, then set Z launch value. | `ue-launch-velocity-z-relation`. | Avoid testing untaught coordinate knowledge as if already known. |
| Compile | Compile and inspect status. | Verification procedure. | Diagnostic recovery on compile failure. |
| Predict | Before play test, predict what should happen on entering Collision. | Causal integration. | None normally. |
| Play test | Enter the pad and observe launch. | Outcome + verification Evidence. | Recovery if behavior fails. |
| Independent variation | Change launch strength and predict/observe resulting jump height. | Generalization of Z/value relation. | Same-Unit enrichment. |
| Diagnostic variant | Present a realistic broken connection/value and ask learner to localize, repair, and retest. | Debugging process Evidence. | Stronger checks only after learner diagnosis attempt. |
| Rejoin | Teacher releases the next common activity. | Classroom synchronization. | Unmet Evidence remains for later remediation. |

## Why instruction-first can be correct here

An absolute novice cannot meaningfully infer an unfamiliar Unreal context-menu path such as:

```text
Collision
-> Add Event
-> Add OnComponentBeginOverlap
```

from first principles.

The v2 policy therefore must be able to choose a worked/guided first encounter for unfamiliar
tool operations while still eliciting reasoning about meaningful relationships such as:

- what triggers the event;
- what `Other Actor` represents;
- what object should be launched;
- which parameter controls vertical movement;
- what should be verified after editing.

The model does not require "problem solving first" everywhere.

## Fading at the operation level

The current lesson contains repeated UI mechanics:

```text
drag from pin
-> drop
-> search node name
-> select node
```

After this interaction pattern has been learned, later steps should be able to reduce narration.

Example progression:

```text
first occurrence:
  numbered screenshot + exact click/drag/search path

later occurrence:
  "As Character から Launch Character を追加します"

independent:
  "接触したCharacterを上へ飛ばす処理を追加してください"
```

If the learner needs help, the private support layer can restore the detailed path.

This is a procedure-level example of support fading.

## Stateful Task requirement

This stress test exposed that a Task must know important environment state.

For example, the jump-pad task can depend on:

- the correct project being open;
- the fixture assets existing;
- `BP_JumpPad` containing the expected `Collision` component;
- the learner editing the intended Blueprint;
- the graph being in an expected pre-task state.

Likewise, completion can be defined by:

- required event node exists;
- required execution/data connections exist;
- launch parameters are configured;
- Blueprint compiles;
- play-test behavior matches the goal.

This is more precise than treating the task as "follow these seven Actions".

## Observation-channel requirement

Course Docs may not automatically know whether a learner's Unreal graph is correct.

Possible Evidence sources differ in strength:

```text
tool/runtime telemetry
artifact inspection
screenshot/image evidence
teacher observation
learner response
learner self-confirmation
```

A self-check such as "green compile icon is visible" can be instructionally useful without being
machine-verified mastery Evidence.

Teacher View must not display false precision if only self-reported completion is available.

## Process versus final outcome

If the player launches correctly, the final behavior is valuable Evidence, but it does not prove
every intermediate KC independently.

For example, a learner might:

- copy the finished graph;
- receive heavy assistance;
- connect nodes by imitation without understanding `Other Actor`;
- repair a graph by trial and error.

Therefore v2 should combine outcome tasks with targeted questions/variants when the corresponding
conceptual or procedural claim matters.

## Recovery as diagnosis

The existing lesson includes a useful checklist for "jump pad does not work".

v2 can make this more diagnostic:

```text
Does the Blueprint compile?
  no -> inspect compile error
  yes
    ↓
Does the overlap event exist on Collision?
    ↓
Is execution flow connected?
    ↓
Is Other Actor / As Character data flow connected?
    ↓
Is launch Z configured?
    ↓
Retest in play
```

The learner should diagnose before receiving the entire completed graph.

Failure signatures can update misconception/error hypotheses or simply select a recovery branch;
they should not become permanent learner traits.

## Result of the stress test

**PASS with schema extensions.**

The original five-model architecture is sufficient:

- Knowledge Model — the Unreal concepts/procedures;
- Learner Model — independence, assistance, retention, generalization;
- Evidence Model — process/outcome/verification observations;
- Task Model — stateful environment, action plan, failure/recovery structure;
- Pedagogical Policy — guidance, fading, retry, rejoin.

No sixth educational model is required.

However, the stress test adds four semantic requirements to Task/Evidence modeling:

1. explicit initial and goal environment state;
2. ordered/partially ordered action plans and subgoals;
3. observation channel and evidence strength;
4. diagnosable failure states and recovery paths.

See [`schema.md`](./schema.md).

## Regression conditions for procedure-heavy content

Treat these as v2 design regressions:

- every tool action is permanently explained click-by-click even after the interaction is known;
- the learner is asked to discover arbitrary UI paths with no meaningful basis;
- a successful final artifact is treated as proof of every underlying KC;
- "I did it" self-report is silently treated as machine-verified mastery;
- recovery immediately reveals the full finished graph instead of helping localize the fault;
- version-specific UI details leak into the abstract Knowledge Model when they belong in Task
  bindings;
- synchronization forces fast learners into future Units or leaves slower learners permanently
  behind;
- Course Docs claims real-time teacher awareness for external state it cannot observe.

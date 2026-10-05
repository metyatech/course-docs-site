# Learning System v2 semantic schema

> Status: **proposed semantic contract / not implemented**
>
> Examples illustrate meaning. They do not freeze final YAML/JSON/TypeScript serialization.

## Design order

```text
learning claim
    -> evidence needed to justify the claim
    -> task capable of eliciting that evidence
    -> observation
    -> learner-state inference
    -> next instructional decision
```

Task presentation and assessment intent must remain separable.

## Knowledge Model

### Unit

A Unit is a curriculum-level grouping.

```yaml
id: css-class-selector
title: CSS class selectors
goal: >
  Use class names to select intended HTML elements from CSS.
knowledgeComponents:
  - css-class-assign
  - css-class-selector-generate
  - css-class-selector-match
```

### Knowledge Component

A KC is the level at which evidence and learner state are tracked.

```yaml
id: css-class-selector-generate

claim:
  learnerCan: >
    Generate the CSS class selector corresponding to an HTML class name.

condition:
  variability: variable
  relevantFeatures:
    - class-name

response:
  variability: variable
  form: code

forms:
  performance: required
  verbal: required

rationale:
  available: true
  required: true

prerequisites:
  - html-class
  - css-selector-purpose

relations: []
```

The exact fields may change, but these semantic distinctions should survive.

### Condition variability

`constant`: conditions of application do not meaningfully vary for the targeted knowledge.

`variable`: the learner must discriminate or induce when/how the knowledge applies across
meaningfully different conditions.

A variable-condition KC normally requires evidence across multiple contexts.

### Response variability

`constant`: expected response is effectively fixed.

`variable`: learner must construct, adapt, execute, or choose a response that changes with the
situation.

A variable-response KC should eventually require generation or performance evidence rather than
recognition-only assessment.

### Forms

`performance` records whether the learner must be able to do something.

`verbal` records whether an explicit verbalizable representation is part of the intended
knowledge.

Successful performance does not automatically prove verbal/causal understanding, and a verbal
answer does not prove performance capability.

### Rationale

`rationale.available` means the knowledge has a meaningful explanatory relationship,
principle, or reason worth representing.

`rationale.required` means the intended claim includes that understanding.

When rationale is required, the evidence set must include a task that can reveal relational or
causal understanding. Correct final output alone is insufficient.

### Prerequisites and relations

Prerequisites identify KCs whose absence can make target-task evidence uninterpretable.

Relations may later represent decomposition, subgoals, equivalence, contrast, or other useful
knowledge-graph relationships. Do not invent relation types without a demonstrated policy need.

## Learner Model

Keep distinguishable dimensions rather than one mastery score.

```yaml
learnerState:
  css-class-selector-generate:
    independentPerformance: unknown
    assistanceDependence: unknown
    retention: unknown
    generalization: unknown
    calibration: unknown
    misconceptionHypotheses: []
```

Exact state representation may be probabilistic, categorical, continuous, or hybrid; it is not
yet fixed.

### Independent performance

What the learner can do without answer-revealing support.

### Assistance dependence

Degree and type of help required for success.

### Retention

Evidence that knowledge remains accessible after meaningful delay. Same-session success must not
be relabeled as retention.

### Generalization / transfer

Success under changed conditions. The type and magnitude of change must be explicit in the Task
Model.

### Metacognitive calibration

When confidence is collected, combine it with performance rather than treating confidence alone
as knowledge. High-confidence error can be useful diagnostic evidence.

### Misconception hypotheses

Misconceptions are hypotheses inferred from systematic errors, not mandatory static KC fields.

### Temporary state

Frustration or similar session state may influence support policy but should not become a
permanent KC property.

## Evidence Model

Evidence specifications define which observations support which claims.

```yaml
id: class-selector-independent-generation
target: css-class-selector-generate

observable:
  response: generated-code
  correctness: semantic

supports:
  dimension: independent-performance

requires:
  assistance: none
```

Generalization example:

```yaml
id: class-selector-generalization
target: css-class-selector-generate

supports:
  dimension: generalization

requires:
  assistance: none
  contextVariation:
    className: changed
    htmlStructure: changed
```

Retention example:

```yaml
id: class-selector-retention
target: css-class-selector-generate

supports:
  dimension: retention

requires:
  assistance: none
  delay: delayed
```

### Raw observations

Preserve observations before reducing them to learner-state estimates. Candidates include:

- correctness;
- semantic response;
- attempt count;
- response time when educationally meaningful;
- assistance used;
- hint level;
- worked-example exposure;
- independent versus assisted response;
- response type: recognition, generation, execution, explanation, diagnosis, and similar;
- Task context and variant;
- relevant context variation;
- time since instruction or prior retrieval;
- confidence when requested;
- diagnostic error category.

Do not present ungraded free text as semantically correct unless a trustworthy evaluator can
support that claim.

## Task Model

### Task Family

Prefer a controlled family over unrelated one-off questions.

```yaml
id: class-selector-generate
targets:
  - css-class-selector-generate

dimensions:
  className:
    role: relevant
  elementType:
    role: surface
  elementCount:
    role: variation
  htmlStructure:
    role: variation
  hasIdDistractor:
    role: contrast

response:
  kind: code

evaluator:
  kind: css-selector

allowedAssistance:
  - none
  - conceptual-hint
  - worked-example

difficultyDrivers: []
prerequisiteDependencies: []

canProduceEvidence:
  - class-selector-independent-generation
  - class-selector-generalization

variationRules: []
```

Candidate dimension roles:

- `relevant`;
- `surface`;
- `variation`;
- `contrast`.

These are semantic concepts, not final enum commitments.

### Difficulty

Do not model difficulty only as historical percentage correct.

Where possible, represent why a variant is harder: additional relevant features, competing cues,
longer dependency chains, increased response construction, or other meaningful drivers.

Avoid construct-irrelevant difficulty.

### Task usage

One Task Family can provide variants for:

- worked example;
- completion;
- guided practice;
- independent practice;
- contrast;
- retrieval;
- diagnostic debugging;
- generalization;
- transfer.

Usage is selected by Pedagogical Policy and evidence requirements, not by the visual component
name alone.

## Pedagogical Model / Policy

Policy consumes:

```text
Knowledge Model
+ Learner Model
+ Task Model
+ Evidence history
+ elapsed time
+ Class State
```

and selects the next instructional action.

Candidate internal states:

```text
ORIENT
ELICIT
SUPPORT / MODEL
DISCUSS
RESOLVE
GUIDED
INDEPENDENT
DEBUG
RETRIEVE
TRANSFER
REMEDIATE
```

Do not expose those state names to learners merely because they exist internally.

### Novice support and fading

A useful pattern for some generative skills:

```text
worked example
    -> completion
    -> guided generation
    -> independent generation
```

This is a policy pattern, not a mandatory sequence for every KC.

### Concept elicitation and discussion

For concept questions, collect individual responses without revealing the answer. If the class
has a productive mixture of responses, peer discussion may be selected before resolution.

Do not use a single fixed response-percentage threshold across all task types.

### Remediation versus class progression

When only some learners need help, use private remediation when possible. If the same
misconception is widespread, Class State can justify common resolution or additional modeling.

The teacher remains responsible for releasing the next major core step.

## Class State

Possible aggregates:

- total expected responses;
- response count;
- aggregate correctness;
- answer distribution;
- error-category distribution;
- learners requiring support;
- learners not responding.

Class aggregates used by Teacher View must not automatically become learner-visible.

## Debugging Task Family

Candidate observable sub-processes:

```text
symptom observation
failure localization
hypothesis formation
hypothesis testing
repair
verification
```

A repaired final artifact alone is weak evidence because the learner may have changed code
without correctly diagnosing the cause.

## Validator contract candidates

### Strong error candidates

- variable-condition KC has only one substantively identical context;
- variable-response KC is assessed only through recognition;
- `rationale.required=true` but no Evidence can reveal causal/relational understanding;
- independent mastery is claimed from an attempt that used answer-revealing help;
- retention is claimed without meaningful temporal separation;
- transfer is claimed without meaningful condition change;
- a Task depends so strongly on untargeted prerequisites that target-KC interpretation is
  invalid;
- several KCs are all marked mastered solely because one final artifact works;
- debugging mastery is claimed solely from a working final result;
- prediction or retrieval reveals the answer before learner response;
- ungraded free text is presented as semantically correct without a semantic evaluator.

### Review-only candidates

Some properties should remain AI/human review rather than fake machine certainty:

- whether an explanation is genuinely clear;
- whether a context change is meaningful enough for a specific transfer claim;
- whether a distractor reflects a realistic misconception;
- whether a worked example is optimally segmented.

## Relationship to v1 metadata

v1 concepts `phase`, `pattern`, and `strategy` are not assumed to remain authored metadata.

In v2:

- "initial" can emerge from lack of prior Evidence;
- "practice" can emerge from an active KC plus incomplete independence;
- "retrieval" requires elapsed time and a retrieval Task;
- "transfer" requires explicit condition change and an Evidence claim;
- instruction-first versus problem-solving-first can be selected by policy from KC properties,
  learner state, and task suitability.

The final implementation may retain explicit author controls where justified, but should not
preserve v1 metadata solely for backward compatibility.


## Runtime orchestration structure

The five models describe instructional meaning, but the classroom runtime also needs an explicit
representation of the current **shared core step** and temporary private branches.

A conceptual runtime object may contain:

```yaml
classStep:
  id:
  sharedActivity:
  revealGate: teacher-controlled
  privateBranches:
    allowed: true
    kinds:
      - hint
      - worked-example
      - remediation
      - enrichment
  rejoin:
    required: true
    onTeacherRelease: true
  progressionRole: blocking | non-blocking
```

This is not a sixth learning model. It is runtime orchestration state connecting the Pedagogical
Policy to Presentation, Student, and Teacher Views.

The runtime must support:

```text
shared core step
    -> optional learner-private branch
    -> rejoin
    -> teacher releases next shared core step
```

A private branch must not silently advance a learner into a future Unit.

### Blocking versus non-blocking activity

The system needs to distinguish activities required for the current common progression from
optional exploration or enrichment.

A non-blocking activity:

- may produce useful Evidence;
- may deepen or broaden learning;
- must not prevent the class from reaching the next rejoin point;
- must not be mistaken for required mastery evidence merely because it exists.

## Linked contrast sequences

Some learning depends on observing a controlled sequence of changes rather than unrelated task
variants.

The Task Model therefore needs a way to represent a **linked contrast sequence** or equivalent
semantic structure.

Example:

```text
A: CSS uses p selector
B: add class="nedan" only; CSS still uses p
C: change selector from p to .nedan
```

The instructional value comes from knowing exactly what changed between A -> B and B -> C.

A conceptual representation may include:

```yaml
contrastSequence:
  invariantDimensions:
    - css-declarations
    - content
  steps:
    - id: tag-selector
    - id: class-added-only
      changedDimensions:
        - html-class
    - id: class-selector-active
      changedDimensions:
        - css-selector
```

Exact syntax is unresolved. The semantic requirement is that the system can preserve controlled
comparisons and avoid changing multiple explanatory variables at once.

## Evidence contamination and exposure

An attempt made after the learner has seen the answer, canonical solution, or an
answer-revealing worked example is not equivalent to a fresh independent attempt.

Raw Evidence therefore needs enough lineage to know whether the learner had prior answer
exposure for the same or effectively identical Task.

The exact representation is unresolved, but the Evidence Model must be able to distinguish:

```text
fresh independent attempt
assisted attempt
post-answer retry
new independent variant after prior instruction
```

A post-answer retry can be useful practice, but must not automatically satisfy an independent
mastery claim.


## Stateful external-tool tasks

Procedure-heavy learning in tools such as Unreal Engine requires a Task to represent more than a
prompt and expected answer. The same five-model architecture still applies, but the Task Model
needs explicit **environment state transitions**.

A conceptual task may include:

```yaml
environment:
  product: unreal-engine
  versionRange:
  fixture:
  prerequisites: []

initialState:
  required: []

goalState:
  required: []

actionPlan:
  subgoals: []
  orderingConstraints: []
  acceptablePaths: []

observables: []
```

The exact serialization is unresolved. The semantic requirement is that the system can
distinguish:

```text
required starting state
    -> learner action or action sequence
    -> resulting tool/artifact state
```

This prevents a procedure from being represented as a flat checklist with no understanding of
state dependencies.

### Goal semantics versus UI path

When possible, keep the learning claim at the goal/capability level and keep version-specific UI
locators in the Task/environment binding.

Example:

```text
Knowledge claim:
  add an overlap event for the intended Collision component

Current Unreal UI path:
  Collision context menu
  -> Add Event
  -> Add OnComponentBeginOverlap
```

The second may change across tool versions without necessarily changing the underlying learning
claim.

If the exact UI path itself is an intended skill, it can still be represented as performance
knowledge; do not assume every click path is conceptually important.

## Action plans and scaffolding levels

Some response forms are ordered or partially ordered action sequences.

The Task Model therefore needs to support subgoals and ordering constraints rather than treating
all performance as one atomic response.

A procedure can be scaffolded at different levels:

```text
full worked action sequence
    -> step prompts with screenshots
    -> subgoal prompts
    -> goal-only instruction
    -> independent performance
```

Fading should remove support that the learner no longer needs while preserving the same learning
goal.

Repeated tool mechanics can fade independently of new conceptual content. For example, after a
learner has already practiced "drag from a pin -> search -> add node", later tasks can state the
desired node connection with less click-by-click narration unless the learner needs recovery
support.

## Observation channels and evidence strength

External-tool tasks are not always automatically observable by Course Docs.

Raw Evidence must record **how the observation was obtained**, not only the claimed result.

Candidate channels include:

- direct runtime or tool telemetry;
- artifact/state inspection;
- screenshot or image evidence;
- teacher observation;
- learner-entered response;
- learner self-confirmation.

A conceptual observation may include:

```yaml
observation:
  channel: artifact-inspection
  targetState:
  result:
  evaluator:
  reliability:
```

Exact reliability representation is unresolved.

A learner clicking "done" is useful orchestration data, but it must not be silently treated as
equivalent to an automatically or independently verified state.

Likewise, a final artifact can be valid outcome Evidence without necessarily proving that the
learner independently executed every intermediate procedure.

## Process versus outcome Evidence

For multi-step procedures, distinguish:

- **outcome Evidence** — the final application/tool state is correct;
- **process Evidence** — the learner selected and executed relevant intermediate actions;
- **diagnostic Evidence** — the learner can identify why an incorrect state occurred;
- **verification Evidence** — the learner checks that the intended behavior actually occurs.

Different claims require different combinations.

A working Unreal Blueprint, for example, can support an outcome claim. It does not by itself
prove that the learner understood execution flow, data flow, diagnosis, or verification.

## Failure states and recovery

Stateful Tasks should be able to declare common or diagnostically meaningful failure states.

Conceptually:

```yaml
failureModes:
  - id:
    signature:
    likelyTargets: []
    recovery:
      checks: []
      supportEscalation: []
```

A recovery path should preferably narrow the fault rather than immediately reveal the full final
solution.

Example sequence:

```text
behavior fails in play
    -> check compile status
    -> inspect event existence
    -> inspect execution connection
    -> inspect data/target connection
    -> inspect parameter value
    -> retest
```

Failure-mode metadata is a Task/Evidence concern, not a permanent misconception attached to every
learner.

## Instrumentation-aware orchestration

Teacher View can only display trustworthy real-time completion or error information when the
underlying Task has an observation channel that supplies it.

The runtime must not pretend to know external-tool state that it cannot observe.

Therefore each classroom Task should expose its orchestration capability, for example:

```text
machine-observable
artifact-observable
response-observable
self-reported-only
not observable
```

Exact names are unresolved.

When a task is not directly observable, Course Docs can still use explicit learner responses,
teacher checks, or later independent Evidence, but Teacher View should communicate the
difference rather than presenting false precision.


## Executable-code tasks and semantic oracles

Executable programming tasks add an important distinction: the system may be able to execute the
learner's submission and observe behavior directly, but **behavioral correctness and evidence for
a specific KC are not always the same thing**.

The Task/Evidence contract therefore needs explicit evaluation layers.

### Evaluation layers

Candidate layers include:

- **parse / syntax** — can the program be parsed?
- **runtime safety** — does execution complete without an uncaught exception for the scenario?
- **behavior** — does the observable output/DOM/state match the required behavior?
- **structure / mechanism** — did the learner use a required construct or relationship when that
  construct itself is the target?
- **explanation / diagnosis** — can the learner explain or localize why the behavior occurs?

A conceptual evaluator may contain:

```yaml
evaluator:
  syntax:
    required: true

  scenarios:
    - setup:
      htmlFixture:
      inputState:
    - actions: []
      expected:
        domState:
        console:
        returnValue:

  structuralRequirements: []
  forbiddenShortcuts: []

  isolation:
    resetBetweenScenarios: true
```

Exact syntax is unresolved.

### Behavior oracle versus mechanism oracle

If the learning claim is:

```text
clicking the Calculate button updates #total to the correct value
```

then behavior can be primary Evidence.

If the learning claim is:

```text
register a click handler with addEventListener
```

then equivalent output produced by unrelated means does not establish that KC. Structural or
instrumented Evidence is needed.

Likewise, if the target is `document.querySelector`, a correct final DOM state produced without
selecting the intended element does not by itself prove selector knowledge.

Do not impose source-code shape constraints unless the mechanism is genuinely part of the
learning target. Multiple semantically valid solutions should remain acceptable when the target
is behavioral.

## Temporal scenarios for event-driven code

Event-driven programs must often be evaluated as a **state trajectory**, not one final snapshot.

Conceptual form:

```text
initial DOM
    -> learner code loads
    -> user changes input
    -> input event fires
    -> DOM updates
    -> user clicks
    -> click event fires
    -> DOM updates again
```

A Task Family should be able to define scenario actions and expected checkpoints.

Candidate actions include:

- click;
- type/change input;
- keydown/keyup;
- dispatch event;
- wait for a bounded async transition.

Candidate checkpoints include:

- DOM property/attribute/text/style;
- console output;
- thrown error;
- application state;
- callback/event count.

The evaluator must reset or isolate state between scenarios so one scenario cannot accidentally
make another pass.

## Multi-case evaluation and hard-coded success

One example input is weak Evidence for variable-condition programming knowledge.

Where the target requires a general rule, evaluate several meaningful variants or generated test
cases.

Example for a price calculator:

```text
adult=1, child=2 -> 1100
adult=0, child=3 -> 900
adult=2, child=0 -> 1000
```

The purpose is not maximal test volume. It is to distinguish a general implementation from a
hard-coded answer or one-example imitation.

The Task Model should record which input/context dimensions vary and why.

## Runtime failures as diagnostic Evidence

Programming Tasks should preserve distinct failure classes when observable.

Candidate categories:

- syntax / parse error;
- reference or null-access error;
- selector mismatch;
- wrong element selected;
- event not registered;
- wrong event type;
- handler registered on wrong element;
- missing value conversion;
- incorrect calculation;
- assignment to wrong DOM property;
- correct code but wrong fixture/initial state.

These categories can route targeted remediation. They are observations or diagnostic hypotheses,
not permanent labels on the learner.

## Program tracing and prediction

For executable code, `ELICIT` can often use a short trace/prediction before execution:

```text
Which element will querySelector('p') return?
What will this element's style be after the line executes?
Will the total change before or only after the click?
What value/type does input.value produce?
```

After commitment, run the code and show the actual result.

This can create the same prediction -> observation -> explanation structure used in the CSS
reference while grounding it in program execution.

Do not require tracing for every line. Use it when execution order, selection, state change, or
data transformation is the intended learning target.

## Code-generation scaffolds

Programming support can fade across several response forms:

```text
worked code example
    -> completion / missing expression
    -> Parsons or reorderable subgoals when appropriate
    -> partial code generation
    -> independent code generation
```

These are optional policy tools, not mandatory stages.

When a learner struggles with code generation, a scaffold may reduce the search space while
preserving the targeted relationship. A later fresh variant is still needed before claiming
independent generation.

## Execution sandbox requirements

Any executable evaluator must define enough isolation to make Evidence trustworthy.

Requirements may include:

- deterministic fixture initialization;
- reset between attempts/scenarios;
- bounded execution time;
- controlled network/storage access as appropriate;
- captured exceptions and console output;
- no contamination from a prior solution or scenario.

This is primarily an implementation/safety contract, but it directly affects Evidence validity.

# CSS box-model reference experience

> Status: **v2 reference model / acceptance fixture**
>
> This document does not change the current CSS lesson. It records the experience future v2
> behavior should preserve or improve.

## Reference version

- prototype: **v6.13**
- SHA-256:
  `598A8624EE11F5D4268A874B771A7D2A51ADB326DF7B93EEC1326F508E2D2177`
- historical local path:
  `C:\Users\Origin\learning-ui-preview-v6-13.html`

The local file is not a required dependency. The behavioral requirements are recorded here.

## Acceptance principle

For:

```text
novice learner
+ css-class-selector
+ no prior evidence
```

v2 should produce an experience at least as coherent, concise, and learnable as v6.13.

If an abstraction, schema, compiler, or adaptive feature makes the learner experience worse,
revise the model rather than degrading this reference.

## Normative reference contracts

This file is the normative learner-experience contract for the box-model reference. Summaries in
other v2 documents may point to these contracts, but they must not silently weaken, optionalize,
or omit them. If a summary and this detailed reference disagree, stop and reconcile the documents
before implementation rather than choosing the weaker interpretation.

Stable acceptance IDs for the class-selector slice:

| Contract ID | Required relation |
| --- | --- |
| `BM-CLS-ORIENT-01` | Minimal orientation gives enough context without pre-explaining the target rule. |
| `BM-CLS-PREDICT-01` | Learner predicts every element selected by `p` before the result is revealed. |
| `BM-CLS-OUTCOME-01` | Post-attempt feedback shows the concrete rendered outcome, not correctness alone. |
| `BM-CLS-REASON-01` | Learner infers or explains what `p` selects before the canonical explanation is shown. |
| `BM-CLS-CLASS-ONLY-01` | Adding `class="nedan"` alone leaves the rendered result unchanged while CSS still selects `p`. |
| `BM-CLS-ACTIVATE-01` | Changing only `p` to `.nedan` makes only the intended element change. |
| `BM-CLS-GENERATE-01` | Learner generates `.waku` from `class="waku"` before seeing the answer. |
| `BM-CLS-VARY-01` | A fresh class-name variation checks that the learner can apply the relation again. |

These IDs name instructional contracts, not UI components or serialization fields.

## Reference flow: class selector

### 1. Minimal orientation

Give only enough context to understand the task. Avoid a long explanation of the rule before the
learner has a reason to notice the distinction.

### 2. Prediction before answer

Show HTML such as:

```html
<p>おすすめ</p>
<h2>チョコドーナツ</h2>
<p>ふんわり生地にチョコがけ。</p>
<p>180円</p>
```

and CSS such as:

```css
p {
  background-color: #ffedd5;
  color: #7c2d12;
}
```

Ask the learner to select every element they predict will receive the style.

Do not expose the correct result before response.

### 3. Concrete post-attempt result

After response, show the actual rendered result.

Possible correct-prediction wording:

> 予想どおり、3つの `p` 要素に色が付き、`h2` 要素には付きませんでした。

Possible incorrect-prediction wording:

> 実際には、3つの `p` 要素に色が付き、`h2` 要素には付きませんでした。

Exact wording is local. The requirement is concrete outcome feedback rather than only
"correct/incorrect".

### 4. Learner generation before canonical explanation

For this reference slice, prompt the learner to infer or explain what `p` is selecting before
showing the canonical explanation. This is the required `BM-CLS-REASON-01` contract, not an
optional embellishment.

Do not reveal the full canonical explanation first because that would eliminate the intended
generation.

Then resolve:

> `p` セレクターは、HTML内のすべての `p` 要素を選びます。

### 5. Isolate the causal change

Add only:

```html
<p class="nedan">180円</p>
```

while keeping CSS as `p { ... }`.

Show that appearance does **not** change yet.

Only afterward change:

```css
p
```

to:

```css
.nedan
```

Then show that only the price changes.

This staged contrast is a central acceptance requirement.

### 6. Independent generation on a new class

Present:

```html
<div class="waku">...</div>
```

and ask the learner to generate the selector without showing `.waku` first.

Expected response:

```css
.waku
```

### 7. Adaptive private support

The common core step stays the same while support may differ.

```text
Learner A
  independent .waku
  -> no unnecessary hint
  -> optional same-KC enrichment

Learner B
  waku
  -> targeted reminder about class="nedan" <-> .nedan
  -> retry

Learner C
  repeated errors
  -> small worked example / completion scaffold
  -> retry
```

The adaptive mechanism should remain largely invisible as a system concept.

### 8. Minimal generalization check

A short variation such as:

```text
class="price" -> ?
```

can distinguish rule generalization from one-item imitation.

Do not add many repetitive questions merely to expose the internal model.

### 9. Optional exploration remains optional

Exploration such as changing colors may be useful, but must not block core progression when it
does not supply required Evidence.

## Learner-facing coherence requirements

Preserve these properties:

- no answer leakage before prediction or retrieval;
- specific outcome feedback after an attempt;
- causal/relational explanation when it adds learning value;
- generation/self-explanation before canonical explanation when explanation would pre-empt
  intended thinking;
- causal changes separated when this helps learners see what caused the result;
- unnecessary status narration removed;
- no duplicate sentence that only repeats an already-obvious result;
- visual results and concise textual mappings can coexist when each adds learning or
  accessibility value;
- future content remains hidden until useful;
- prior content remains accessible when it supports comparison or reference;
- optional exploration is clearly optional;
- no childish gamification by default;
- learner-facing text remains concise enough that reading the interface is not extraneous work.

Examples of status narration to avoid by default:

- 「予想を記録しました。」
- 「CSSを追加しました。」
- 「ここから下に、追加後の結果を表示します。」

Keep status text when the learner genuinely needs confirmation, recovery information,
accessibility feedback, or an otherwise ambiguous action result.

## Candidate Knowledge Components

The current v1 model has four broad Units:

- `css-class-selector`
- `css-box-size`
- `css-border`
- `css-padding`

v2 likely needs finer KCs.

### Class selector

- `css-class-assign`
  - assign an appropriate class to the intended HTML element;
- `css-class-selector-generate`
  - generate `.foo` from `class="foo"`;
- `css-class-selector-match`
  - predict that `.foo` selects elements carrying that class;
- optionally, a selection-contrast KC
  - explain or predict how tag and class selectors differ in selected elements.

`.nedan`, `.waku`, and `.price` are Task variants, not separate KCs.

### Width and height

- `css-size-property-select`
  - choose `width` for horizontal size and `height` for vertical size;
- `css-content-box-size`
  - understand and predict that width/height apply to the content box under the lesson's box
    sizing assumptions.

### Border

- `css-border-role`
- `css-border-shorthand`

A debugging variant can use:

```css
border: 2px #7a4b2a;
```

and ask why the border is not visible when the style component is omitted under the relevant CSS
rules.

### Padding

- `css-padding-role`
- `css-padding-single-value`

### Integrated box model

- `css-box-model-layer-relation`
  - understand the relation among content, padding, and border and predict changes when those
    layers change.

The current lesson explains this relationship, but the v1 Unit/Evidence structure does not track
it independently.

## Evidence examples

### Class selector generation

Independent Evidence should require generated syntax without answer-revealing help.

### Generalization

Meaningful variation may include:

- element type;
- HTML nesting;
- multiple matching elements;
- a plausible id/class contrast.

The Task Model should record which dimension was varied.

### Width / height

Use prediction and rendered change, not only property-name recall.

### Padding / border

Use comparisons that make spatial roles visible and ask learners to predict affected regions.

### Integrated box model

Useful sequence:

```text
predict
    -> observe result
    -> map content / padding / border
    -> explain the relation
    -> apply it under a changed size or structure
```

## Early finisher versus learner needing support

```text
early finisher
  -> meaningful variation
  -> contrast
  -> debugging
  -> near transfer

learner needing support
  -> smaller step
  -> hint
  -> worked example
  -> completion
  -> retry
```

Neither path automatically changes the class's future Unit.

## Rejoin behavior

When the teacher releases the next core step:

- all learners rejoin;
- private remediation does not strand a learner indefinitely;
- unmet Evidence remains in the Learner Model;
- later practice, retrieval, or prerequisite support can revisit it.

## Instructional visual contract

Visual presentation is not automatically a local styling detail. When a visual or spatial
relationship carries instructional meaning, it is part of the acceptance contract.

Preserve these semantics:

- code, the learner action, and the rendered consequence should be visually associated closely
  enough that the learner does not have to reconstruct the relation from memory;
- before/after states should remain comparable when comparison is the learning mechanism;
- when a controlled contrast changes one explanatory variable, visual emphasis should make that
  change observable without introducing unrelated visual changes;
- a reveal should preserve useful prior context instead of replacing it with an unrelated
  generic result card when the comparison itself matters;
- content/padding/border and similar spatial relations must be represented visually when the
  visual relation is what the learner is expected to understand;
- interaction controls should support the lesson flow rather than making the experience feel
  primarily like a form or quiz dashboard;
- information that would reveal a future answer remains hidden, but information needed to
  understand the current comparison remains visible.

Exact typography, decorative color choices, corner radii, shadows, and similar styling remain
local decisions **only when changing them does not weaken these instructional relations**.

The reference does not require a pixel-for-pixel copy of v6.13. It does require preservation or
improvement of the visual/spatial mechanisms through which v6.13 made the targeted relationships
easy to notice.

## Regression conditions

Treat these as regressions relative to the reference:

- more explanation/status prose without additional learning value;
- answer leakage before learner generation;
- loss of prediction -> result -> reasoning -> resolution;
- loss of the class-only then selector-change causal contrast;
- teacher metadata on the learner/shared display;
- adaptive routing becoming learner-facing complexity;
- extra interactions whose only purpose is to expose the internal model;
- replacing concrete rendered results with abstract system-state text;
- making the page less natural merely to make schema boundaries visible.

The schema serves the experience. The experience does not exist to demonstrate the schema.

## Full reference lesson flow

The following end-to-end flow is the current reference for a first-pass v2 box-model lesson.
Exact wording and purely presentational styling remain local design details. The instructional
sequence, information availability, causal contrasts, spatial relationships, and visual states
needed to make those relationships observable are acceptance requirements. A generic layout that
preserves the step order but weakens those relations is a regression.

| Step                            | Shared learner experience                                                                                                                                   | Main Evidence / purpose                           | Private adaptation                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Goal preview                    | Show the finished product visually without exposing all solution code.                                                                                      | Orientation only.                                 | None required.                                                                     |
| Tag-selector prediction         | Show several elements and `p { ... }`; learner predicts every affected element before reveal.                                                               | `css-selector-tag-match`; prior-state diagnostic. | Hint only after first commitment if needed.                                        |
| Result and explanation          | Reveal the actual affected elements, then require the learner to infer/explain what `p` selects before showing the canonical explanation.                  | Concrete feedback; `BM-CLS-REASON-01`; rationale formation. | Additional explanation only when needed.                                           |
| Add class only                  | Add `class="nedan"` while CSS remains `p`; show that appearance is unchanged.                                                                               | Controlled causal contrast.                       | None normally.                                                                     |
| Activate class selector         | Change only `p` -> `.nedan`; show that only the price changes.                                                                                              | `css-class-selector-match`; rationale.            | Targeted support for class/selector mapping.                                       |
| Generate new selector           | Give `class="waku"`; learner generates `.waku`.                                                                                                             | Independent `css-class-selector-generate`.        | Hint -> worked example -> retry as needed.                                         |
| Minimal variation               | Use a new class name and, when useful, a changed HTML structure.                                                                                            | Generalization check.                             | Early finisher can receive stronger variation.                                     |
| Width model                     | Apply `width: 300px` to the card and observe the horizontal content region change.                                                                          | Meaning of `width`; rendered-effect mapping.      | Worked example if property-role knowledge is absent.                               |
| Height completion               | Ask learner to complete the corresponding property for vertical size, then apply it.                                                                        | `css-size-property-select`; generated response.   | Hint can contrast horizontal/vertical.                                             |
| Size variation                  | Change width or height in a new small Task and predict the rendered direction of change.                                                                    | Independent size application.                     | Additional variation for early finishers.                                          |
| Border model                    | Add `border: 2px solid ...`; observe the new boundary.                                                                                                      | `css-border-role`.                                | None normally.                                                                     |
| Border decomposition            | Vary thickness, style, or color one dimension at a time and connect each value to its effect.                                                               | `css-border-shorthand`; relational understanding. | Completion scaffold if construction is difficult.                                  |
| Border generation               | Give a desired border and ask learner to construct the shorthand.                                                                                           | Independent border construction.                  | Progressive hints.                                                                 |
| Padding prediction              | With border visible, add `padding: 20px`; learner predicts where space will appear before reveal.                                                           | `css-padding-role`.                               | Visual hint can point to content versus border without revealing final size.       |
| Padding result                  | Reveal increased space between content and border.                                                                                                          | Concrete feedback and role resolution.            | Additional explanation only when needed.                                           |
| Single-value check              | Ask what regions `padding: 20px` affects.                                                                                                                   | `css-padding-single-value`.                       | Contrast with an intentionally different case if needed.                           |
| Integrated box-model prediction | Show content + padding + border and ask whether adding padding/border leaves the outer box unchanged or makes it larger under the taught assumptions.       | `css-box-model-layer-relation`.                   | Layer highlighting if needed.                                                      |
| Layer resolution                | Visually map content -> padding -> border and explain that width/height describe content while padding/border add outside it in this lesson's model.        | Causal/relational Evidence.                       | A stronger worked visual for learners needing support.                             |
| Changed-condition application   | Use different dimensions/values and ask learner to predict which layer and overall region changes.                                                          | Generalization of integrated relation.            | Early finisher may compute exact outer size; this need not block core progression. |
| Independent build               | Learner adds a new marker/card treatment using class selection, size, border, and padding.                                                                  | Performance practice.                             | Private scaffolds allowed.                                                         |
| Component-level checks          | During/after the build, evaluate selector, size, border, and padding decisions separately rather than treating the working final card as proof of every KC. | Interpretable KC Evidence.                        | Remediation targets the failed component only.                                     |
| Debugging                       | Present a realistic fault such as a class-name mismatch or missing border style and require diagnosis -> repair -> verification.                            | Debugging process Evidence.                       | Early finisher or targeted remediation.                                            |
| Rejoin                          | Teacher releases the next common step.                                                                                                                      | Classroom synchronization.                        | Unmet Evidence persists for later remediation.                                     |

### Quantitative outer-size calculation

The core lesson needs learners to understand that padding and border add outside the content box
under the assumptions being taught.

An exact calculation such as:

```text
300px content
+ 20px left padding
+ 20px right padding
+ 2px left border
+ 2px right border
= 344px outer width
```

can be useful Evidence of deeper understanding, but is not currently required as a universal
blocking step. It may be used as enrichment or promoted to core Evidence if later curriculum
analysis shows that exact box-size calculation is an intended prerequisite.

Do not introduce `box-sizing` merely to make this optional calculation more complex unless that
concept is part of the intended course scope.

## Later retrieval reference

Immediate practice is not the end of the learning sequence.

A later lesson should be able to present a fresh context with no visible solution and ask for
short retrieval such as:

```text
class="price" -> generate selector
choose width versus height for a stated dimension
construct a simple border
predict where padding appears
```

The same-session page must not label these as retention Evidence.

## Later transfer reference

A later transfer Task should preserve the target relationship while changing meaningful
conditions, for example:

- product card -> profile/information panel;
- different HTML nesting;
- several elements sharing a class;
- plausible class/id/tag distractors;
- a spacing or border bug requiring the same box-model relationships.

Surface renaming alone is not enough to establish transfer.

## Schema findings discovered by the full lesson

Walking the full lesson exposed three requirements that were easy to miss in the abstract model:

1. **linked contrast sequences** are needed to represent causal comparisons such as
   class-added-only -> selector-changed;
2. **runtime core step / private branch / rejoin** must be represented explicitly somewhere in
   orchestration state;
3. **answer-exposure lineage** is needed so a post-solution retry is not mistaken for fresh
   independent Evidence.

These requirements are reflected in [`schema.md`](./schema.md).

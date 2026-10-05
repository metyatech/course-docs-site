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

### 4. Generation before canonical explanation when useful

Prompt the learner to infer or explain what `p` is selecting.

Do not reveal the full canonical explanation first when that would eliminate the intended
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
<div class="waku">
    ...
</div>
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

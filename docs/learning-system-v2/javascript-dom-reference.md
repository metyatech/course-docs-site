# JavaScript DOM executable-code reference

> Status: **v2 stress-test reference / not implemented**
>
> Source material: current `metyatech/javascript-course-docs` lessons
> `content/docs/basics/dom-css/index.mdx` and
> `content/docs/basics/dom-events/index.mdx`.
> This document does not modify those lessons.

## Why this stress test matters

The CSS box-model reference tests conceptual contrast and visible rendering.

The Unreal reference tests GUI procedure, tool state, and external observation.

JavaScript DOM tasks add a third pattern:

- generated source code can be executed automatically;
- the system can often inspect DOM/runtime state directly;
- multiple implementations may be behaviorally equivalent;
- events create time-dependent behavior;
- syntax, runtime, logic, selection, type conversion, and event wiring can fail differently;
- one final output may hide which programming KC was actually learned.

This is a direct stress test of the Evidence evaluator.

## Representative learning targets

The current lessons include:

- `document.querySelector(selector)`;
- CSS selector syntax used from JavaScript;
- "first matching element" semantics;
- `element.style.property = value`;
- camelCase JS style names such as `backgroundColor`;
- `input.value`;
- `Number(...)` conversion;
- `addEventListener`;
- click/input event behavior;
- reading inputs, computing a result, and writing it back to the DOM.

## Candidate Knowledge Components

### DOM selection

- `js-query-selector-call`
  - call `document.querySelector` with an appropriate selector;
- `js-query-selector-first-match`
  - predict/understand that `querySelector` returns the first matching element;
- `js-selector-from-target`
  - construct an appropriate tag/id/class/descendant selector for the intended element.

### DOM/CSS mutation

- `js-style-assignment`
  - assign a CSS value through an element's `style`;
- `js-css-property-camelcase`
  - map relevant hyphenated CSS property names to JavaScript style property names;
- `js-dom-target-mutation`
  - change the intended element without unintentionally changing other elements.

### Values and conversion

- `js-input-value-read`
  - read an input's `.value`;
- `js-input-value-string`
  - understand that input values are strings;
- `js-number-conversion`
  - convert a numeric string when arithmetic requires numeric behavior.

### Events

- `js-event-register`
  - register a handler on the intended element/event type;
- `js-event-trigger-relation`
  - understand that the callback runs in response to the specified event;
- `js-event-handler-state-update`
  - read current state/input and update the intended output inside the handler.

### Integrated calculator

A calculator Task can combine the above KCs, but working output alone must not automatically mark
every KC mastered.

## Reference flow: querySelector

### 1. Predict selection

Given:

```html
<p>段落1</p>
<p>段落2</p>
<p id="main">段落3</p>
```

and:

```js
document.querySelector("p");
```

ask which element will be returned before execution.

### 2. Execute and observe

Run the code and display the actual selected element.

Resolve that `querySelector` returns the first matching element.

### 3. Contrast selectors

Use controlled variants:

```text
p
#main
.someClass
.container p
```

Ask the learner to predict or generate the selector for the intended target.

Do not require every selector form before it has been taught.

### 4. Independent generation

Give a fresh HTML structure and target element, then require the learner to write the
`querySelector` expression.

Evaluate the selected DOM element semantically, not by exact source-string equality when multiple
equivalent selectors are acceptable.

## Reference flow: JavaScript style mutation

Start with one visible element and a simple style assignment.

Before execution, ask what will change.

Then run:

```js
document.querySelector(".taitoru").style.color = "blue";
```

and show the actual DOM/rendered result.

For `background-color -> backgroundColor`, use a comparison/generation step so the learner must
form the JavaScript property rather than only copy it.

Independent Evidence should use a fresh element/selector/property combination.

## Reference flow: events and calculator

The current calculator is a useful integrated Task but should be decomposed instructionally.

A strong sequence is:

1. identify/select the input, button, and output elements;
2. establish that `.value` reads a string;
3. predict what arithmetic/concatenation would do without conversion when relevant;
4. convert with `Number(...)`;
5. register the click handler;
6. predict whether the output changes before or after the click;
7. click and observe the output;
8. vary adult/child counts;
9. test several cases;
10. later remove some scaffolding and generate the event-driven solution independently.

The runtime evaluator can execute scenarios such as:

```text
initial:
  adult=1
  child=2
action:
  click #calcBtn
expected:
  #total.value == "1100"
```

and additional variants:

```text
adult=0, child=3 -> "900"
adult=2, child=0 -> "1000"
```

Multiple cases reduce the chance that a hard-coded `1100` is accepted as general understanding.

## Behavior correctness versus target-mechanism Evidence

This distinction is central.

### Behavior target

If the claim is:

> The learner can make the displayed total update correctly when the button is clicked.

then semantic behavior tests can accept multiple valid implementations.

### Mechanism target

If the claim is:

> The learner can register a click handler with `addEventListener`.

then behavior alone is insufficient. A solution that sets the result by some unrelated mechanism
does not establish that KC.

The evaluator therefore may inspect or instrument:

- whether the intended element has the relevant listener;
- whether `addEventListener` is used when it is itself the target;
- whether the callback is triggered by the specified event.

Do not require exact code formatting or variable names unless those are themselves learning
targets.

## Temporal Evidence

For event-driven code, one final DOM snapshot is insufficient.

The evaluator should be able to distinguish:

```text
before click: total empty
after click with 1/2: total 1100
change inputs to 2/0
after click: total 1000
```

For an `input`-event version:

```text
change input
-> input event
-> total updates without button click
```

This temporal relation is part of the learning claim.

## Diagnostic debugging variants

Useful novice bugs derived from the actual lesson include:

### Selector mismatch

```js
document.querySelector(".titel");
```

when the HTML contains `class="title"`.

Expected learning process:

```text
observe null-related/runtime failure or missing effect
-> inspect selector against HTML
-> identify mismatch
-> repair
-> rerun
```

### Wrong CSS property spelling

```js
element.style.background-color = 'yellow'
```

or another deliberately malformed/incorrect property representation appropriate to the taught
scope.

Use only errors that can be presented accurately in JavaScript syntax and do not conflate parse
errors with semantic style-property mistakes.

### Missing numeric conversion

```js
let a = adultYoso.value;
let b = childYoso.value;
totalYoso.value = a + b;
```

A diagnostic Task can use values such as `1` and `2` and ask why the output becomes a string
combination instead of the intended numeric total.

### Wrong event type or element

Attach the handler to an inappropriate element/event and ask the learner to diagnose why the
expected interaction does not trigger.

Debugging Evidence should record diagnosis, repair, and successful retest separately.

## Scaffold fading

A novice may first see a complete worked example:

```js
let button = document.querySelector("#calcBtn");

button.addEventListener("click", function () {
  // ...
});
```

Then use completion:

```js
let button = document.querySelector(________);

button.addEventListener(________, function () {
  // ...
});
```

Then a subgoal scaffold:

```text
1. 計算ボタンを取得する
2. クリック時の処理を登録する
3. 入力値を読む
4. 数値に変換する
5. 合計を表示する
```

Finally require fresh independent code generation.

Optional Parsons-style rearrangement can be used between worked example and free generation when
it preserves the target and reduces unproductive syntax/search load.

## Teacher View possibilities

JavaScript tasks are unusually suitable for trustworthy real-time aggregation when they run in a
controlled Course Docs sandbox.

Teacher View may be able to show:

```text
answered / running / passed
syntax error
runtime error
selector mismatch
event not firing
wrong numeric result
passed behavior tests
```

But error classification must come from actual evaluator evidence. Do not infer a misconception
solely from one failing test.

## Result of the stress test

**PASS with evaluator extensions.**

The original five models remain sufficient.

This stress test adds five semantic requirements:

1. layered evaluators: syntax, runtime, behavior, mechanism/structure, explanation;
2. temporal event scenarios and checkpoints;
3. multiple meaningful test cases for variable-condition rules;
4. sandbox/reset semantics for trustworthy repeated execution;
5. explicit distinction between behavior correctness and Evidence for a target mechanism.

These requirements are reflected in [`schema.md`](./schema.md).

## Cross-domain conclusion

After the CSS, Unreal, and JavaScript stress tests, the same architecture covers three
substantially different learning modes:

```text
CSS:
  conceptual contrast + visible state

Unreal:
  external GUI procedure + artifact/tool state

JavaScript:
  executable code + runtime/event behavior
```

The five-model separation survives all three. Differences belong mainly in Task/Evidence
semantics and the Pedagogical Policy's choice of support, rather than requiring domain-specific
learning architectures.

## Regression conditions for executable-code content

Treat these as regressions:

- exact source-string matching when multiple semantically correct programs should pass;
- behavior-only grading when a specific programming mechanism is the learning target;
- structure-only grading when the actual behavior is the target;
- one hard-coded example accepted as evidence of a variable rule;
- final DOM state checked without the required event/action sequence;
- learner code executed without reliable reset/isolation;
- a runtime failure classified as a conceptual misconception without sufficient evidence;
- scaffolded/post-answer code accepted as fresh independent generation;
- debugging reduced to showing the final correct code immediately.

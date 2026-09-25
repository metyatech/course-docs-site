# Course learning model

Course Docs can derive a course progression report from learning objectives stored once at course level and explicit learning occurrences in MDX. Pages remain display and distribution units; they are not objectives. Existing content repositories without `learning-units.yaml` continue to build with the existing behavior.

## Define learning units

Create one `learning-units.yaml` at the root of the course content repository. Give each objective a stable lowercase kebab-case ID. Write the objective once in this file; do not copy it into pages.

```yaml
version: 1
units:
  - id: scene-work
    objective: Can prepare and edit a scene for a task.
  - id: place-object
    parent: scene-work
    objective: Can place and position an object in a scene.
  - id: adjust-properties
    parent: scene-work
    objective: Can change an object's relevant properties.
```

Units with children are **Composite Units**: they group related objectives and may have no direct Learning Events. Units without children are **Leaf Units**: each is a canonical objective and must be covered by at least one Learning Event. The platform derives these roles from the hierarchy; do not add a `type` field.

The verifier rejects invalid or duplicate IDs, empty objectives, unknown parents, and hierarchy cycles. It also reports Leaf Units without Events and rejects more than one `initial` introduction for the same Leaf Unit. A single Event may introduce multiple units together.

## Add Learning Events to Sections

A Learning Event records how a learner encounters one or more units on one occasion. Add `eventId`, `targets`, and `phase` to an existing `<Section>`. Targets are comma-separated IDs from `learning-units.yaml`; headings and titles never determine targets.

```mdx
<Section
  title="オブジェクトを配置する"
  goal="オブジェクトをシーン内に配置できます"
  eventId="place-object-intro"
  targets="place-object"
  phase="initial"
  pattern="instruction-first"
>
  <Instruction>
    <Concept title="配置位置">配置位置は、オブジェクトを置く場所です。</Concept>
    <Action>ビューポートでオブジェクトを配置し、位置を調整します。</Action>
  </Instruction>
  <ProblemSolving>
    <QuickCheck>
      配置したオブジェクトが意図した場所にあるか、何を見て確かめますか。
      <Hint>ビューポートでオブジェクトと周囲の位置関係を見ます。</Hint>
      <Answer>
        周囲との位置関係を確認します。名前や一覧だけでは、画面上の場所までは確かめられません。
      </Answer>
    </QuickCheck>
  </ProblemSolving>
  <Evidence targets="place-object" demonstrates="application">
    <Verify>オブジェクトが意図した位置にあることを確認します。</Verify>
  </Evidence>
</Section>
```

Exactly one page contains a complete Event. Do not reuse one Event ID on multiple pages or split its stages across pages. A page is a display unit; the Event is the instructional occurrence contained within it. Event-bearing Sections cannot nest inside other Event-bearing Sections. A grouping `<Section>` without Event metadata may contain an Event-bearing Section, and an Event-bearing Section may contain ordinary non-event sub-Sections.

Event order is derived from Nextra `_meta.ts` navigation order when it lists pages. Unlisted pages use a stable path order and the report marks the overall order as uncertain. That fallback provides repeatable output; it is not a claim about teaching order. Do not maintain a separate Learning Plan or teacher-lesson graph.

## Mark the initial learning pattern

Every `initial` Event requires an explicit `pattern` and explicit stage markers. The markers are platform components that preserve their children and let validation inspect structure without guessing from prose or task names.

For **instruction-first**, put an `<Instruction>` stage before a `<ProblemSolving>` stage:

```mdx
<Section
  title="初めて設定する"
  goal="設定を変更できます"
  eventId="change-setting-intro"
  targets="adjust-properties"
  phase="initial"
  pattern="instruction-first"
>
  <Instruction>
    <Action>設定の場所と変更方法を確認します。</Action>
  </Instruction>
  <ProblemSolving>
    ### 演習1
    <Exercise>目的に合う設定へ変更します。</Exercise>
  </ProblemSolving>
</Section>
```

For **problem-solving-first**, reverse the stage order. The Event can then teach the needed ideas and include the learner's first application and feedback before it ends:

```mdx
<Section
  title="位置を調整する"
  goal="位置を調整できます"
  eventId="adjust-position-intro"
  targets="place-object"
  phase="initial"
  pattern="problem-solving-first"
>
  <ProblemSolving>
    ### 演習1
    <Exercise>見本を参考にせず、オブジェクトの位置を調整してみます。</Exercise>
  </ProblemSolving>
  <Instruction>
    <Concept title="位置の調整">座標を変えると、オブジェクトの位置が変わります。</Concept>
  </Instruction>
  <ProblemSolving>
    <Action>座標を調整して目的の位置に置きます。</Action>
    <Evidence targets="place-object" demonstrates="application">
      <Verify>画面上で位置を確認します。</Verify>
    </Evidence>
  </ProblemSolving>
</Section>
```

`strategy="productive-failure"` is an optional label for a `problem-solving-first` initial Event only. It requires a `<ProblemSolving>` stage followed by an `<Instruction>` stage. The platform verifies these declared stages, not whether the struggle or later explanation was educationally productive. This label does not mean that every problem-solving-first lesson uses Productive Failure.

## Record later encounters

After the one initial introduction for a Leaf Unit, use `practice`, `retrieval`, or `transfer` for later Events. Keep each occurrence in its own page-local Section Event and give it a new stable Event ID.

```mdx
<Section
  title="あとから思い出す"
  goal="手順を思い出して実行できます"
  eventId="place-object-retrieval-1"
  targets="place-object"
  phase="retrieval"
>
  <QuickCheck>
    オブジェクトの位置を調整する手順を、画面を見ずに説明してください。
    <Hint>位置を変える操作と結果を確かめる操作を思い出します。</Hint>
    <Answer>位置を調整し、ビューポートで意図した場所にあるか確かめます。</Answer>
  </QuickCheck>
  <Evidence targets="place-object" demonstrates="retrieval">
    <QuickCheck>
      位置を調整したあと、どこを見て結果を確認しますか。
      <Hint>配置したものが表示される画面を思い出します。</Hint>
      <Answer>ビューポートを見ます。実際の位置関係を確認できます。</Answer>
    </QuickCheck>
  </Evidence>
</Section>
```

An Event's `phase` describes that occurrence. The platform reports later recurrence as a fact about another non-initial Event. Without explicit session or time separation, it does not claim that recurrence was distributed practice. It may report mixed-target practice or target alternation when the Event structure makes those facts explicit; it does not infer that interleaving has been achieved.

## Bind evidence to an assessment

`<Evidence>` adds metadata to exactly one existing learner-facing assessment surface: `<Verify>`, `<QuickCheck>`, `<Checkpoint>`, or `<Exercise>`. It does not replace or change that surface. The targets must be a subset of the enclosing Event's targets.

Use `demonstrates="application"` for applying a skill, even when the surface is an Exercise:

```mdx
### 演習1

<Evidence targets="place-object" demonstrates="application">
  <Exercise>指定された場所にオブジェクトを配置してください。</Exercise>
</Evidence>
```

Use `demonstrates="retrieval"` when the learner recalls knowledge or a procedure:

```mdx
<Evidence targets="place-object" demonstrates="retrieval">
  <QuickCheck>
    位置を調整する手順を説明してください。
    <Hint>位置を変える操作と結果の確認を思い出します。</Hint>
    <Answer>位置を調整し、表示結果を確認します。</Answer>
  </QuickCheck>
</Evidence>
```

Use `demonstrates="transfer"` only when the author explicitly intends the assessment to show applying learning in a different context:

```mdx
### 演習1

<Evidence targets="place-object" demonstrates="transfer">
  <Exercise>初めて使うシーンで、目的に合う場所へオブジェクトを配置してください。</Exercise>
</Evidence>
```

An Exercise does not automatically count as transfer. Component names do not determine evidence kind. `<Recovery>` is not an assessment surface and cannot be wrapped as evidence. The platform checks the declared structure and IDs; it does not claim to judge the quality of the assessment or the learner's mastery.

## Validate and inspect the derived report

After content sync, `npm run verify:content` validates a configured learning model and its page metadata. `npm run learning:report` prints the derived progression; `npm run learning:report -- --json` prints the same data as JSON. With no `learning-units.yaml`, verification and site builds retain the existing legacy behavior.

The report contains:

- Unit hierarchy and derived Leaf or Composite classification.
- Each Event's ID, targets, phase, and page, in available Nextra navigation order.
- Initial introductions and later recurrence for each Unit.
- Evidence kinds and the page/Event where each was declared.
- Leaf Event/evidence coverage and Composite direct/descendant coverage.
- Errors for duplicate Event IDs, unknown targets, missing Leaf Event coverage, multiple initial introductions, invalid nesting, and invalid metadata; missing evidence is a note.
- Whether page order is certain. Any fallback order is deterministic but is not presented as lesson order.

The course progression is derived from `learning-units.yaml` and MDX Events. Do not write a duplicate Learning Plan or maintain another outline graph.

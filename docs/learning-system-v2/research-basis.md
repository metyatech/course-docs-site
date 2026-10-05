# Research basis for Learning System v2

> Status: supporting research map for the proposed design.
>
> This is not a complete literature review. It records the main research lines behind the
> current v2 design and separates direct support from Course Docs-specific synthesis.

## Provenance notation

- **R** — supported in the same direction by multiple independent studies or research
  syntheses within relevant boundary conditions.
- **S** — Course Docs-specific synthesis built from research-supported premises.
- **L** — local, normative, product, authoring, or platform decision.
- **U** — unresolved by available evidence.

Strict enforcement does not turn an `L` decision into an empirical finding.

## Knowledge-Learning-Instruction framework

Koedinger, Corbett, and Perfetti (2012), *The Knowledge-Learning-Instruction Framework:
Bridging the Science-Practice Chasm to Enhance Robust Student Learning*.

https://onlinelibrary.wiley.com/doi/10.1111/j.1551-6709.2012.01245.x

Supports:

- Knowledge Components as a useful level linking knowledge, learning processes, and
  instruction. **R**
- Distinguishing conditions, responses, verbal forms, and rationales. **R**
- Selecting instruction according to KC properties rather than only subject labels. **R**
- Robust learning includes retention and generalization/transfer rather than immediate
  performance only. **R**

Course Docs synthesis:

- derive instructional requirements from KC characteristics rather than requiring authors to
  choose `fact / concept / procedure / principle`; **S**
- track multiple evidence dimensions per KC. **S**

## Active learning in STEM

Freeman et al. (2014), *Active learning increases student performance in science, engineering,
and mathematics*.

https://pubmed.ncbi.nlm.nih.gov/24821756/

Supports learner activity rather than exclusively passive lecture in STEM settings. **R**

Course Docs synthesis: teacher-led pages should repeatedly require prediction, answering,
generation, discussion, practice, or retrieval rather than only scrolling through explanation.
**S**

## Formative feedback

Shute (2008), *Focus on Formative Feedback*.

https://doi.org/10.3102/0034654307313795

Van der Kleij, Feskens, and Eggen (2015), *Effects of Feedback in a Computer-Based Learning
Environment on Students' Learning Outcomes: A Meta-Analysis*.

https://journals.sagepub.com/doi/10.3102/0034654314564881

Supports:

- feedback should help repair/refine understanding rather than merely report a score; **R**
- elaborated or answer-informative feedback is generally more useful than correctness-only
  feedback for many learning outcomes. **R**

Course Docs synthesis:

- after prediction, show the concrete observed result and add causal/relational explanation when
  useful; **S**
- remove redundant status narration when it contributes no learning, action, recovery, or
  accessibility value; **S/L**
- exact supportive wording is local. **L**

## Prediction / prequestions

Research on prequestions and prediction supports directing attention to targeted content before
instruction, with boundary conditions.

Course Docs uses targeted prediction when the learner can make a meaningful commitment and the
answer can remain hidden until after the attempt. It does not require prediction before every
explanation. **S**

## Self-explanation and learner generation

Research syntheses on self-explanation support generating relationships/reasons when aligned to
the knowledge target.

Course Docs synthesis:

- if canonical explanation would reveal what learners are supposed to generate, stage
  attempt/result -> learner generation -> canonical explanation; **S**
- do not require self-explanation for every trivial fact or obvious result. **S**

## Worked examples, fading, and expertise reversal

Worked-example research and expertise-reversal findings support stronger guidance for novices and
reducing redundant support as knowledge increases.

Supports:

- worked examples can reduce unproductive search for novices; **R**
- support useful for low-knowledge learners can become redundant for more knowledgeable
  learners. **R**

Course Docs synthesis:

- worked example -> completion -> increasingly independent performance is an available policy
  pattern; **S**
- individualize support quantity inside a synchronized Unit rather than making everyone consume
  maximum support. **S**

## Productive Failure / problem solving before instruction

Meta-analytic work on problem solving before instruction / Productive Failure:

https://journals.sagepub.com/doi/10.3102/00346543211019105

Supports:

- under appropriate conditions, problem solving before instruction can improve later conceptual
  learning; **R**
- this does not imply unguided discovery is always optimal. **R**

Course Docs synthesis:

- `ELICIT` may be a bounded prediction, diagnosis, or generation task instead of a full final
  problem for an absolute novice; **S**
- whether instruction precedes or follows initial problem solving should be policy-driven rather
  than universally author-fixed. **S**

## Peer Instruction

Discussion timing / initial-response research:

https://pmc.ncbi.nlm.nih.gov/articles/PMC4353089/

Majority-influence research:

https://pmc.ncbi.nlm.nih.gov/articles/PMC2879379/

Supports:

- individual commitment followed by peer discussion can improve conceptual responses when there
  is productive disagreement; **R**
- revealing aggregate distributions before discussion can bias later responses. **R**

Course Docs synthesis:

- keep class distributions off shared Presentation View before discussion; **S**
- use Teacher View for aggregate awareness; **S**
- reported percentage bands are context-specific, not universal routing constants. **S**

## Classroom orchestration and teacher awareness

Classroom-orchestration research supports systems that help teachers maintain awareness of many
learners while coordinating shared activity.

Course Docs synthesis:

- Presentation, Student, and Teacher Views operate over one shared lesson state; **S**
- large-scale class position remains teacher-controlled while private support can branch; **S**
- Teacher View should favor concise awareness over prose-heavy coaching. **S/L**

## Adaptive support

Meta-analytic review of adaptive training/instruction:

https://pmc.ncbi.nlm.nih.gov/articles/PMC12413037/

Supports adaptation of difficulty, scaffolding, and remediation in relevant settings. **R**

Course Docs synthesis: personalize hint strength, examples, remediation, and same-Unit challenge
while preserving common pacing. **S**

## Retrieval and spacing

Classroom-focused meta-analytic work on distributed/spaced practice:

https://pmc.ncbi.nlm.nih.gov/articles/PMC12189222/

Supports spaced/distributed practice for longer-term retention in relevant educational contexts.
**R**

Course Docs synthesis:

- immediate independent success should not permanently close a KC; **S**
- later lessons can reintroduce KCs through retrieval and changed-context tasks; **S**
- exact scheduling algorithm remains unresolved. **U**

## Evidence-Centered Design and learning-oriented ECD

Useful starting points:

https://www.ets.org/research/policy_research_reports/publications/report/2011/imbu.html

https://nap.nationalacademies.org/catalog/10019/knowing-what-students-know-the-science-and-design-of-educational

Supports separation of proficiency/knowledge claims, evidence, and tasks. **R**

Course Docs synthesis: represent Knowledge, Learner, Evidence, Task, and Pedagogical Policy as
explicit layers. **S**

## Cognitive Task Analysis

Meta-analytic work:

https://digitalcommons.usu.edu/itls_facpub/346/

Supports systematic decomposition of expert knowledge/task structure in instructional design.
**R**

Course Docs synthesis: AI agents may propose KC decompositions, but they must remain revisable
from assessment/error data rather than assumed correct. **S**

## Case comparison and variation

Meta-analytic work on case comparison:

https://www.tandfonline.com/doi/full/10.1080/00461520.2013.775712

Supports comparison for abstraction of relevant structure. **R**

Course Docs synthesis:

- Task Families explicitly represent what stays constant and what varies; **S**
- contrast cases are useful for confusable relationships such as tag/class/id and
  border/padding. **S**

## Debugging

Programming-education research treats debugging as a complex process involving diagnosis,
hypothesis, repair, and verification.

Course Docs synthesis:

- model debugging as a multi-KC Task Family rather than a simple KC type; **S**
- do not infer debugging competence solely from a repaired final artifact. **S**

## Metacognition

Metacognitive-prompt research supports specific, instructionally relevant monitoring prompts.
Confidence alone is not a strong enough proxy for correctness.

Course Docs synthesis:

- keep calibration distinct from performance; **S**
- collect confidence only when diagnostic benefit justifies interaction cost. **S/U**

## Coherence and learner-facing noise

Cognitive-load and multimedia-learning research support reducing extraneous processing and
signaling relevant structure.

Course Docs synthesis:

- omit UI narration such as "response recorded" or "CSS added" when it has no learning, action,
  recovery, or accessibility value; **S**
- teacher-only pedagogical labels stay outside the shared learner display unless the label itself
  benefits learners. **S/L**

## Unresolved numeric and policy choices

Research does not supply one universal value for every Course Docs decision. Keep these
unresolved unless separately justified:

- exact class progression percentage;
- exact mastery threshold;
- exact retrieval interval;
- exact retention-decay function;
- exact confidence-prompt frequency;
- exact number of worked examples before fading;
- exact transfer distance for every KC;
- exact Teacher View visualization.


## Programming worked examples, tracing, and completion scaffolds

Muldner, Jennings, and Chiarelli (2023), *A Review of Worked Examples in Programming Activities*.

https://eric.ed.gov/?id=EJ1381113

The review distinguishes code-tracing and code-generation worked examples and reports established
lines of work around program visualization/tracing, subgoal support, and incomplete examples such
as Parsons problems. **R**

Adaptive Parsons work has also investigated using rearrangement problems as optional scaffolds
for learners struggling with write-code tasks:

https://doi.org/10.1145/3501385.3543977

Course Docs synthesis:

- executable programming lessons may use tracing/prediction when execution or state change is
  the target; **S**
- worked code, completion, Parsons-like scaffolds, and partial generation can be support levels
  on the path to fresh independent code generation; **S**
- scaffolded success must not be relabeled as independent generation without a later unassisted
  variant. **S**

## Programming knowledge tracing

A systematic review of knowledge tracing in programming education describes work that models
student knowledge from programming-exercise performance and highlights differences in knowledge
representation, KC granularity, and performance measures.

https://doi.org/10.1109/FIE49875.2021.9637323

This supports keeping programming evidence tied to explicit knowledge representations rather than
treating whole-program correctness as one undifferentiated mastery signal. **R/S**

## Programming debugging interventions

Yang et al. (2024), *Decoding Debugging Instruction: A Systematic Literature Review of Debugging
Interventions*.

https://doi.org/10.1145/3690652

The review describes debugging as a complex activity involving program understanding, fault
localization, strategies, and iterative testing, and reviews interventions including modeling,
worked examples, tracing/comprehension support, and scaffolding. **R**

Course Docs synthesis:

- preserve syntax/runtime/logical failure classes when observable; **S**
- use runtime errors and behavioral mismatches as diagnostic Evidence rather than only showing a
  finished answer; **S**
- debugging Tasks should include diagnosis and verification, not merely repair. **S**

import type { Node } from 'unist';
import { resolvePageAuthoringMode } from './page-authoring-mode.js';

/**
 * Remark plugin that lints `<Section>` / `<Action>` / `<Verify>` /
 * `<Reference>` / `<Checkpoint>` usage for the conventions defined in the
 * `tutorial-authoring` skill. Machine-checkable conventions live here
 * (rather than in the skill text) per the `rule-system` mechanisation
 * rule.
 *
 * Severity policy:
 *  - error: structural break that makes the MDX incoherent or loses
 *           required authoring metadata. Blocks the build.
 *  - warn : principle violation with solid empirical support OR a
 *           render/technical bug that would affect rendering.
 *  - note : best-practice advisory derived from a principle whose
 *           specific numeric threshold or lexical pattern does NOT
 *           have direct empirical support. Printed as console.info,
 *           never escalated to error even under TUTORIAL_LINT_STRICT.
 *           Notes surface in collect-all output but do not by
 *           themselves fail the build.
 *
 * Rules implemented:
 *
 *  Structural / technical:
 *  - tutorial/page-authoring-mode-invalid      (error) — invalid page metadata
 *  - tutorial/page-mode-tutorial-requires-section (error) — tutorial page boundary missing
 *  - tutorial/page-mode-non-tutorial-has-section (error) — non-tutorial page uses tutorial boundary
 *  - tutorial/section-goal-required     (error) — missing metadata
 *  - tutorial/action-single-image       (error) — structural break
 *  - tutorial/checkpoint-placement      (warn)  — structure rule
 *  - tutorial/section-no-hrule          (warn)  — structure convention
 *  - tutorial/verify-no-duplicate-arrow (warn)  — render bug
 *  - tutorial/action-positional-prefix  (warn)  — Redundancy (strong)
 *  - tutorial/section-lacks-feedback    (warn)  — Feedback (strong)
 *
 *  Principle-driven advisories (note):
 *  - tutorial/section-goal-tense        (note)  — heuristic endings
 *  - tutorial/reference-image-only      (note)  — design convention
 *  - tutorial/action-bold-overuse       (note)  — Signaling; numeric
 *                                                  threshold is a
 *                                                  professional guess
 *  - tutorial/third-person-reader       (note)  — pattern list heuristic
 *  - tutorial/page-opens-with-doc-description (note) — opener-only scope
 *  - tutorial/verify-internal-mechanics (note)  — pattern list heuristic
 *  - tutorial/concept-length            (note)  — numeric threshold
 *  - tutorial/concept-placement         (note)  — judgement
 *  - tutorial/decorative-emoji          (note)  — allowlist heuristic
 *  - tutorial/verify-visual-workaround-as-action (note) — pattern list heuristic
 *
 * Severity handling:
 *  - Errors call `file.fail()` which throws and fails the MDX compile.
 *  - Warnings call `file.message()` AND emit `console.warn(...)` so they
 *    surface in both `npm run dev` and `npm run build` output regardless
 *    of the loader's vfile-message handling.
 *  - Notes call `console.info(...)` only. They are never escalated to
 *    error, even under strict mode, because their thresholds/patterns
 *    are heuristic rather than empirical.
 *  - Strict mode: setting `TUTORIAL_LINT_STRICT=1` (or `1`/`true`) at
 *    build time promotes every WARNING into a build-failing error. CI
 *    pipelines should enable this to prevent warning drift. Notes are
 *    never promoted.
 *  - Collect-all mode: setting `TUTORIAL_LINT_COLLECT=1` (or `1`/`true`)
 *    suppresses early termination; all findings within a single MDX
 *    file are accumulated. At the end of transform, the collection is
 *    emitted as one aggregated `file.fail()` IF it contains any
 *    warn/error entries; notes-only collections are printed via
 *    console.info and do not fail the build.
 */

const RULE_ORIGIN = 'tutorial-lint';

type MdxAttributeValue =
  | string
  | null
  | {
      type: 'mdxJsxAttributeValueExpression';
      value?: string;
    };

type MdxAttribute = {
  type: 'mdxJsxAttribute';
  name: string;
  value: MdxAttributeValue;
};

type MdxJsxElement = Node & {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  attributes: MdxAttribute[];
  children: Node[];
};

type Parent = Node & { children: Node[] };

type TextNode = Node & { type: 'text'; value: string };

type VFileLike = {
  path?: string;
  fail: (reason: string, place?: unknown, origin?: string) => never;
  message: (reason: string, place?: unknown, origin?: string) => unknown;
};

// Matches the goal-text anti-patterns listed in the tutorial-authoring
// skill: 〜(し|さ|書か|置か...)た状態, 〜している, 〜されている, and the
// retrospective capability form 〜できます. The allowed future capability
// form 〜できるようになります uses 〜できる and is not matched.
const GOAL_PAST_TENSE = /(た状態|している|されている|できます)/;

// Positional prefixes that the image is expected to convey.
const POSITIONAL_PREFIXES = [
  '左側から',
  '左側の',
  '右側から',
  '右側の',
  '画面下部の',
  '画面上部の',
  '画面中央の',
  '上部ツールバーの',
  '下部ツールバーの',
  '左上の',
  '右上の',
  '左下の',
  '右下の',
  '中央の',
];

const POSITIONAL_PREFIX_PATTERN = new RegExp(`(${POSITIONAL_PREFIXES.join('|')})`);

// Signaling dilution: too many bold spans in one Action.
// The specific numeric threshold has no direct empirical backing —
// Mayer's Signaling principle says "signal the important" but not a
// quantity. Set to 5: legitimate signaling surfaces (key-row tables,
// 2-3 numbered callouts plus a typed value) stay under this; 6+ bold
// spans is in "obviously diluted" territory where even without research
// the practitioner can flag it. Emitted as a note, not an error.
const ACTION_BOLD_MAX = 5;

// Personalization: third-person descriptions of the reader.
// These terms frame the reader as an external subject, which contradicts
// Mayer's Personalization principle.
const THIRD_PERSON_READER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /受講者/, label: '受講者' },
  { pattern: /学習者(は|が|の)/, label: '学習者は/が/の' },
  { pattern: /初学者向け/, label: '初学者向け' },
  { pattern: /初心者向け/, label: '初心者向け' },
  { pattern: /ユーザー(は|が)[^。]*(する|します|行う|行います)/, label: 'ユーザーは/が 〜する' },
];

// Personalization: page-opening patterns that describe the document
// instead of addressing the reader directly.
const DOC_DESCRIPTION_OPENER_PATTERNS: RegExp[] = [
  /^この(教材|資料|ページ|授業|ドキュメント|マニュアル|記事|解説|ガイド)は/,
  /^本(教材|資料|ページ|授業|ドキュメント|マニュアル|記事|解説|ガイド)は/,
  /^この(教材|資料|ページ|授業|ドキュメント|マニュアル|記事|解説|ガイド)では/,
];

// Generative activity: Verify that reports internal engine state instead
// of observable behaviour. Observable phrasing uses 〜すれば / 〜と表示 /
// 〜になれば / etc.; internal phrasing names the engine action.
const VERIFY_INTERNAL_MECHANICS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /が実行されました/, label: 'が実行されました' },
  { pattern: /を実行しました/, label: 'を実行しました' },
  { pattern: /が呼び出されました/, label: 'が呼び出されました' },
  { pattern: /をコールしました/, label: 'をコールしました' },
  { pattern: /が(発火|トリガー)/, label: 'が発火/トリガー' },
  { pattern: /が fire/i, label: 'fire (英語)' },
  { pattern: /が trigger/i, label: 'trigger (英語)' },
];

// Feedback / Segmenting: <Action img="..."> whose text uses result-check
// language (conditional/observational phrasing) rather than an imperative
// command. This indicates the Action is being used as a <Verify> workaround
// because the author needs a result-state image that <Verify> previously
// could not carry. Now that <Verify> supports img, these should be migrated.
// Pattern list is heuristic so this is advisory (note level).
const VERIFY_WORKAROUND_AS_ACTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /になれば[^。]{0,20}(?:成功|完了|OK)[。]?/,
    label: '〜になれば成功 (result-check language in <Action>)',
  },
  {
    pattern: /ていれば[^。]{0,20}(?:成功|完了|OK)[。]?/,
    label: '〜ていれば成功 (result-check language in <Action>)',
  },
  {
    pattern: /[てでに]いることを確認/,
    label: '〜ていることを確認 (state-observation language in <Action>)',
  },
  {
    pattern: /このように[^。]{0,30}なっていれば/,
    label: 'このように〜なっていれば (state-check language in <Action>)',
  },
];

// Pre-training: Concept length limits.
// Mayer prescribes "name + key features" but no specific sentence
// count. 5 was arbitrarily tight; 10 is the "obviously too long"
// point where Concept stops functioning as quick pre-training and
// turns into a full explanation that belongs elsewhere. Emitted as
// a note.
const CONCEPT_SENTENCE_MAX = 10;

// Coherence: decorative emoji outside of known cueing positions.
// We match common pictographic ranges (pictographs, misc symbols,
// dingbats, emoticons, transport/map, supplemental symbols).
// ✅ ❌ ⚠️ are used by course authors as deliberate signalling — they
// are allowed in Checkpoint/Reference contexts but flagged elsewhere
// to prevent decorative spread.
const DECORATIVE_EMOJI_PATTERN =
  /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2700}-\u{27BF}]/u;
// Signalling-safe emoji that are permitted even outside cueing positions.
// \u26A0 (warning sign) may appear with or without a trailing variation
// selector (\uFE0F); matching both requires alternation rather than
// putting the variation selector inside a character class.
const ALLOWED_SIGNAL_EMOJI = /[\u2705\u274C\u{1F4A1}\u{1F4D6}]|\u26A0\uFE0F?/u;

const hasChildren = (node: Node): node is Parent => Array.isArray((node as Parent).children);

const isJsxElement = (node: Node, name?: string): node is MdxJsxElement => {
  if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return false;
  if (!name) return true;
  return (node as MdxJsxElement).name === name;
};

const getAttribute = (node: MdxJsxElement, name: string): MdxAttribute | undefined =>
  node.attributes?.find((a) => a?.name === name);

const getStringAttribute = (node: MdxJsxElement, name: string): string | undefined => {
  const attr = getAttribute(node, name);
  if (!attr) return undefined;
  if (typeof attr.value === 'string') return attr.value;
  if (
    attr.value &&
    typeof attr.value === 'object' &&
    attr.value.type === 'mdxJsxAttributeValueExpression' &&
    typeof attr.value.value === 'string'
  ) {
    const literal = attr.value.value.trim();
    const stringMatch = /^(['"`])([\s\S]*)\1$/.exec(literal);
    if (stringMatch) return stringMatch[2];
    return literal;
  }
  return undefined;
};

const collectText = (node: Node): string => {
  if (node.type === 'text') return (node as TextNode).value;
  if (node.type === 'inlineCode' || node.type === 'code') {
    return (node as Node & { value?: string }).value ?? '';
  }
  if (hasChildren(node)) {
    return node.children.map(collectText).join('');
  }
  return '';
};

// Detect `<img>` JSX or Markdown `![...](...)` images inside a subtree.
const countImages = (node: Node): number => {
  let count = 0;
  const walk = (n: Node) => {
    if (n.type === 'image') count += 1;
    if (
      (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') &&
      (n as MdxJsxElement).name === 'img'
    ) {
      count += 1;
    }
    if (hasChildren(n)) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return count;
};

// Count `**bold**` spans (remark `strong` nodes) within a subtree. MDX
// `<strong>` elements are also counted.
const countBoldSpans = (node: Node): number => {
  let count = 0;
  const walk = (n: Node) => {
    if (n.type === 'strong') count += 1;
    if (
      (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') &&
      ((n as MdxJsxElement).name === 'strong' || (n as MdxJsxElement).name === 'b')
    ) {
      count += 1;
    }
    if (hasChildren(n)) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return count;
};

// Rough sentence counter for Japanese prose. Splits on 。 ! ! ? ？ and
// newline/paragraph boundaries.
const countJapaneseSentences = (text: string): number => {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return 0;
  const splits = trimmed
    .split(/[。．.!！?？]/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return splits.length;
};

// Count `table` nodes in a subtree.
const countTables = (node: Node): number => {
  let count = 0;
  const walk = (n: Node) => {
    if (n.type === 'table') count += 1;
    if (hasChildren(n)) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return count;
};

// Detect whether a subtree contains at least one `<Verify>`, `<Recovery>`,
// or `<Checkpoint>` element — i.e. a Feedback / Generative-activity surface.
const containsFeedbackSurface = (node: Node): boolean => {
  let found = false;
  const walk = (n: Node) => {
    if (found) return;
    if (
      (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') &&
      ((n as MdxJsxElement).name === 'Verify' ||
        (n as MdxJsxElement).name === 'Recovery' ||
        (n as MdxJsxElement).name === 'Checkpoint')
    ) {
      found = true;
      return;
    }
    if (hasChildren(n)) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return found;
};

// Detect whether a subtree contains at least one `<Action>` — used to
// decide whether a Section "does operational work" (if not, Feedback
// enforcement is relaxed).
const containsAction = (node: Node): boolean => {
  let found = false;
  const walk = (n: Node) => {
    if (found) return;
    if (
      (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') &&
      (n as MdxJsxElement).name === 'Action'
    ) {
      found = true;
      return;
    }
    if (hasChildren(n)) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return found;
};

// Detect whether a subtree contains nested <Section> elements. When a
// Section delegates its Feedback surfaces to child Sections, the parent
// need not carry its own Verify/Checkpoint.
const containsNestedSection = (node: Node): boolean => {
  let found = false;
  const walk = (n: Node, isRoot: boolean) => {
    if (found) return;
    if (
      !isRoot &&
      (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') &&
      (n as MdxJsxElement).name === 'Section'
    ) {
      found = true;
      return;
    }
    if (hasChildren(n)) {
      for (const child of n.children) walk(child, false);
    }
  };
  walk(node, true);
  return found;
};

// Check whether a <Reference> contains only image-bearing content.
const isReferenceImageOnly = (node: MdxJsxElement): boolean => {
  const meaningful: Node[] = [];
  const walk = (n: Node) => {
    if (n === node) {
      for (const child of node.children) walk(child);
      return;
    }
    if (n.type === 'text' && /^\s*$/.test((n as TextNode).value)) return;
    if (n.type === 'paragraph' && hasChildren(n)) {
      for (const child of n.children) walk(child);
      return;
    }
    meaningful.push(n);
  };
  walk(node);
  if (meaningful.length === 0) return false;
  return meaningful.every((n) => {
    if (n.type === 'image') return true;
    if (
      (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') &&
      (n as MdxJsxElement).name === 'img'
    ) {
      return true;
    }
    if (n.type === 'text' && /^\s*$/.test((n as TextNode).value)) return true;
    return false;
  });
};

const isStrictMode = (): boolean => {
  const raw = process?.env?.TUTORIAL_LINT_STRICT;
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
};

const isCollectMode = (): boolean => {
  const raw = process?.env?.TUTORIAL_LINT_COLLECT;
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
};

type Finding = {
  severity: 'note' | 'warn' | 'error';
  reason: string;
  ruleId: string;
  node: Node;
};

// Per-file finding buffers, keyed by the VFile instance. Populated in
// collect-all mode; drained and thrown in one aggregated file.fail() at
// the end of transform. WeakMap ensures no leak if the plugin is reused.
const findingsByFile = new WeakMap<object, Finding[]>();

const startCollection = (file: VFileLike) => {
  findingsByFile.set(file as unknown as object, []);
};

const getCollection = (file: VFileLike): Finding[] | undefined =>
  findingsByFile.get(file as unknown as object);

const endCollection = (file: VFileLike) => {
  findingsByFile.delete(file as unknown as object);
};

const emitWarning = (file: VFileLike, reason: string, place: Node, ruleId: string) => {
  const origin = `${RULE_ORIGIN}:${ruleId}`;
  const collection = getCollection(file);
  if (collection) {
    collection.push({ severity: 'warn', reason, ruleId, node: place });
    return;
  }
  if (isStrictMode()) {
    // Strict mode promotes warnings into build-failing errors so CI can
    // catch authoring drift. The message body is identical so rule IDs
    // remain matchable.
    file.fail(`${reason} (${ruleId}) [strict]`, place, origin);
    return;
  }
  file.message(reason, place, origin);
  const where = file.path ?? 'unknown';

  console.warn(`[tutorial-lint] ${where}: ${reason} (${ruleId})`);
};

const emitError = (file: VFileLike, reason: string, place: Node, ruleId: string) => {
  const origin = `${RULE_ORIGIN}:${ruleId}`;
  const collection = getCollection(file);
  if (collection) {
    collection.push({ severity: 'error', reason, ruleId, node: place });
    return;
  }
  // `file.fail` throws; construct the full origin so consumers can filter.
  file.fail(`${reason} (${ruleId})`, place, origin);
};

// Note: best-practice advisory whose specific threshold or pattern has
// no direct empirical support. Printed via console.info only, never
// escalated to an error or a vfile message; strict mode ignores it.
const emitNote = (file: VFileLike, reason: string, place: Node, ruleId: string) => {
  const collection = getCollection(file);
  if (collection) {
    collection.push({ severity: 'note', reason, ruleId, node: place });
    return;
  }
  const where = file.path ?? 'unknown';
  console.info(`[tutorial-lint:note] ${where}: ${reason} (${ruleId})`);
};

const flushCollection = (file: VFileLike) => {
  const collection = getCollection(file);
  if (!collection) return;
  endCollection(file);
  if (collection.length === 0) return;
  const lines = collection
    .map(
      (f, i) =>
        `  ${String(i + 1).padStart(2, ' ')}. [${f.severity.padEnd(5, ' ')}] ${f.reason} (${f.ruleId})`,
    )
    .join('\n');
  const hasEscalator = collection.some((f) => f.severity === 'warn' || f.severity === 'error');
  const where = file.path ?? 'unknown';
  const summary = `tutorial-lint (${where}): ${collection.length} issue(s) [collect-all]\n${lines}`;

  if (!hasEscalator) {
    // Notes-only: report but do not fail the build. Thresholds behind
    // notes are heuristic, so they must not gate merges.
    console.info(summary);
    return;
  }

  file.fail(summary, collection[0].node, `${RULE_ORIGIN}:collect-all`);
};

type CheckpointInfo = {
  node: MdxJsxElement;
  indexInParent: number;
  parentChildrenCount: number;
};

type StepContext = {
  section: MdxJsxElement;
  checkpoints: CheckpointInfo[];
};

export default function remarkTutorialLint() {
  return function transform(tree: Node, file: VFileLike) {
    if (isCollectMode()) startCollection(file);

    const pageMode = resolvePageAuthoringMode(tree);

    if (pageMode.mode === null) {
      emitError(
        file,
        `Page frontmatter uses invalid authoringMode "${pageMode.rawValue}"; use "tutorial" or "non-tutorial"`,
        tree,
        'page-authoring-mode-invalid',
      );
      flushCollection(file);
      return;
    }

    if (pageMode.mode === 'non-tutorial') {
      if (pageMode.hasTutorialSection) {
        const reason = pageMode.explicit
          ? 'Page declares `authoringMode: non-tutorial` but still uses <Section>; keep short procedural blocks inline or split the tutorial into its own page'
          : 'Page uses <Section> but omits `authoringMode`; pages without `authoringMode` default to `non-tutorial`, so add `authoringMode: tutorial` or remove <Section>';
        emitError(file, reason, tree, 'page-mode-non-tutorial-has-section');
        flushCollection(file);
        return;
      }

      // Non-tutorial pages are intentionally out of scope for tutorial lint.
      flushCollection(file);
      return;
    }

    if (!pageMode.hasTutorialSection) {
      emitError(
        file,
        'Page declares `authoringMode: tutorial` but has no <Section>; tutorial pages must use <Section> to mark the page-level learning milestones',
        tree,
        'page-mode-tutorial-requires-section',
      );
      flushCollection(file);
      return;
    }

    // Page-level checks that need the full tree root.
    validatePageOpener(file, tree);
    validateThirdPersonReader(file, tree);
    validateDecorativeEmoji(file, tree);

    const walk = (node: Node, stepContext: StepContext | null, sectionDepth: number) => {
      if (!hasChildren(node)) return;

      // Track horizontal rule placement inside any <Section>.
      if (isJsxElement(node, 'Section')) {
        for (const child of node.children) {
          if (child.type === 'thematicBreak') {
            emitWarning(
              file,
              '<Section> should not contain a horizontal rule (`---`); use it only between top-level Steps',
              child,
              'section-no-hrule',
            );
          }
        }
      }

      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];

        if (isJsxElement(child, 'Section')) {
          const goal = getStringAttribute(child, 'goal');
          if (goal === undefined || goal.trim().length === 0) {
            emitError(
              file,
              '<Section> is missing a `goal` prop (every Section must declare its milestone)',
              child,
              'section-goal-required',
            );
          } else if (GOAL_PAST_TENSE.test(goal)) {
            emitNote(
              file,
              `<Section goal="..."> uses past/completed form ("${goal}"); consider future-declarative form (e.g. "〜します" / "〜できるようになります"). Specific ending patterns are heuristic, so this is advisory only`,
              child,
              'section-goal-tense',
            );
          }

          // A top-level Section (directly below the document root) represents
          // a Step for placement purposes. Nested Sections inherit the outer
          // Step context so Checkpoints inside subsections are still rolled
          // up to that Step.
          const childAsStep: StepContext =
            sectionDepth === 0
              ? { section: child, checkpoints: [] }
              : (stepContext ?? { section: child, checkpoints: [] });

          walk(child, childAsStep, sectionDepth + 1);

          if (sectionDepth === 0) {
            validateCheckpointPlacement(file, childAsStep);
            validateSectionFeedback(file, child);
          }
          continue;
        }

        if (isJsxElement(child, 'Action')) {
          validateAction(file, child);
        }

        if (isJsxElement(child, 'Verify')) {
          validateVerify(file, child);
        }

        if (isJsxElement(child, 'Reference')) {
          validateReference(file, child);
        }

        if (isJsxElement(child, 'Concept')) {
          validateConcept(file, child, node.children, i);
        }

        if (isJsxElement(child, 'Checkpoint') && stepContext) {
          stepContext.checkpoints.push({
            node: child,
            indexInParent: i,
            parentChildrenCount: node.children.length,
          });
        }

        walk(child, stepContext, sectionDepth);
      }
    };

    walk(tree, null, 0);

    // Collect-all mode: throw one aggregated error listing every finding.
    flushCollection(file);
  };
}

function validateAction(file: VFileLike, node: MdxJsxElement) {
  const imgAttr = getStringAttribute(node, 'img');
  const imageCount = countImages(node) + (imgAttr ? 1 : 0);

  if (imageCount > 1) {
    emitError(
      file,
      '<Action> contains more than one image; split into separate Actions (one image per Action)',
      node,
      'action-single-image',
    );
  }

  if (imgAttr) {
    const body = collectText(node);
    const match = POSITIONAL_PREFIX_PATTERN.exec(body);
    if (match) {
      emitWarning(
        file,
        `<Action img="..."> body contains positional prefix "${match[1]}"; the image is expected to convey position — remove the prefix or add a callout to the image`,
        node,
        'action-positional-prefix',
      );
    }
  }

  // Signaling dilution: too many bold spans destroy emphasis effectiveness.
  const boldCount = countBoldSpans(node);
  if (boldCount > ACTION_BOLD_MAX) {
    emitNote(
      file,
      `<Action> contains ${boldCount} bold spans (advisory max: ${ACTION_BOLD_MAX}); consider diluting — reserve bold for the few elements the learner must find or type. Numeric threshold is advisory, not empirical`,
      node,
      'action-bold-overuse',
    );
  }

  // Verify internal-mechanics phrasing can also appear inside an Action
  // body when the author mistakes an inline result for an engine report.
  const bodyText = collectText(node);
  const internal = detectInternalMechanics(bodyText);
  if (internal) {
    emitNote(
      file,
      `<Action> body describes internal mechanics ("${internal}"); consider rewriting as an observable result the learner can see. Pattern list is heuristic`,
      node,
      'verify-internal-mechanics',
    );
  }

  // Feedback / Segmenting: <Action img> with result-check language suggests
  // the author is working around <Verify>'s former lack of an img prop.
  // Now that <Verify img> is supported, migrate these to <Verify img>.
  // Only fires when the Action has an img prop (text-only Actions can
  // legitimately say "confirm that X" as inline result).
  if (imgAttr) {
    const workaround = detectVerifyWorkaround(bodyText);
    if (workaround) {
      emitNote(
        file,
        `<Action img="..."> body uses result-check language ("${workaround}") — this looks like a <Verify> workaround. Use <Verify img="..."> instead so the result state carries its intended feedback semantics. Pattern list is heuristic`,
        node,
        'verify-visual-workaround-as-action',
      );
    }
  }
}

function validateVerify(file: VFileLike, node: MdxJsxElement) {
  const body = collectText(node).trimStart();
  if (body.length === 0) return;
  // The <Verify> component renders its own leading "→" arrow. Authors who
  // additionally include "→" in the source produce a doubled arrow at
  // render time.
  if (body.startsWith('→')) {
    emitWarning(
      file,
      '<Verify> body starts with "→", but the Verify component already renders the arrow; remove the leading "→" from the source',
      node,
      'verify-no-duplicate-arrow',
    );
  }

  // Generative activity: Verify should describe observable state, not
  // engine / internal mechanics. Pattern list is heuristic so this is
  // an advisory note.
  const internal = detectInternalMechanics(body);
  if (internal) {
    emitNote(
      file,
      `<Verify> describes internal mechanics ("${internal}"); consider rewriting as an observable outcome the learner can see (e.g. "キューブが消えれば成功"). Pattern list is heuristic`,
      node,
      'verify-internal-mechanics',
    );
  }
}

function detectInternalMechanics(text: string): string | null {
  for (const { pattern, label } of VERIFY_INTERNAL_MECHANICS_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function detectVerifyWorkaround(text: string): string | null {
  for (const { pattern, label } of VERIFY_WORKAROUND_AS_ACTION_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function validateReference(file: VFileLike, node: MdxJsxElement) {
  if (isReferenceImageOnly(node)) {
    emitNote(
      file,
      '<Reference> contains only an image; success-verifying screenshots typically belong in an always-visible <Action>. This is a design convention, so treat as advisory',
      node,
      'reference-image-only',
    );
  }
}

function validateConcept(
  file: VFileLike,
  node: MdxJsxElement,
  siblings: Node[],
  indexInParent: number,
) {
  // Pre-training: Concept length limits (5 sentences or 1 short table).
  const body = collectText(node);
  const sentenceCount = countJapaneseSentences(body);
  const tableCount = countTables(node);

  if (sentenceCount > CONCEPT_SENTENCE_MAX) {
    emitNote(
      file,
      `<Concept> has ${sentenceCount} sentences (advisory max: ${CONCEPT_SENTENCE_MAX}); consider splitting into multiple Concepts. Specific sentence count is a professional guess, not an empirical threshold`,
      node,
      'concept-length',
    );
  }
  if (tableCount > 1) {
    emitNote(
      file,
      `<Concept> contains ${tableCount} tables (advisory max: 1); consider splitting the concept`,
      node,
      'concept-length',
    );
  }

  // Pre-training × Minimalism: Concept MUST be followed by a Procedure /
  // Action / nested Section that actually uses the term. If the Concept
  // trails at the end of its parent with no usage site, it is either
  // front-loaded or orphaned.
  let foundUsageSite = false;
  for (let j = indexInParent + 1; j < siblings.length; j += 1) {
    const sibling = siblings[j];
    if (
      (sibling.type === 'mdxJsxFlowElement' || sibling.type === 'mdxJsxTextElement') &&
      ['Action', 'Procedure', 'Section', 'Verify', 'Exercise'].includes(
        (sibling as MdxJsxElement).name ?? '',
      )
    ) {
      foundUsageSite = true;
      break;
    }
    // Nested children may still contain a usage site.
    if (hasChildren(sibling) && containsUsageSite(sibling)) {
      foundUsageSite = true;
      break;
    }
  }
  if (!foundUsageSite) {
    emitNote(
      file,
      '<Concept> has no following Action/Procedure/Section/Exercise that uses the term in its parent; Pre-training suggests placing Concepts immediately before first-use. This is a structural judgement — the exception is a legitimate trailing summary',
      node,
      'concept-placement',
    );
  }
}

function containsUsageSite(node: Node): boolean {
  let found = false;
  const walk = (n: Node) => {
    if (found) return;
    if (
      (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') &&
      ['Action', 'Procedure', 'Section', 'Verify', 'Exercise'].includes(
        (n as MdxJsxElement).name ?? '',
      )
    ) {
      found = true;
      return;
    }
    if (hasChildren(n)) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return found;
}

function validateSectionFeedback(file: VFileLike, section: MdxJsxElement) {
  // Feedback / Generative activity: a Section that does operational work
  // (contains at least one Action) MUST expose at least one feedback
  // surface (Verify / Recovery / Checkpoint). Grouping-only Sections that
  // delegate to nested Sections are exempt.
  if (!containsAction(section)) return;
  if (containsFeedbackSurface(section)) return;
  if (containsNestedSection(section)) return;
  emitWarning(
    file,
    '<Section> contains Actions but no <Verify>, <Recovery>, or <Checkpoint>; add a feedback surface so the learner can confirm the outcome (Feedback / Generative activity)',
    section,
    'section-lacks-feedback',
  );
}

// Personalization: flag a page that opens by describing itself instead of
// addressing the reader. We inspect the first non-empty paragraph outside
// of any JSX wrapper.
function validatePageOpener(file: VFileLike, tree: Node) {
  if (!hasChildren(tree)) return;
  for (const child of tree.children) {
    if (child.type === 'yaml' || child.type === 'toml' || child.type === 'mdxjsEsm') continue;
    if (child.type === 'heading') continue;
    if (child.type === 'paragraph') {
      const text = collectText(child).trim();
      if (text.length === 0) continue;
      for (const pattern of DOC_DESCRIPTION_OPENER_PATTERNS) {
        if (pattern.test(text)) {
          emitNote(
            file,
            `Page opens with a document-describing sentence ("${text.slice(0, 30)}..."); consider second-person direct address — opening with an action or inviting goal is typically stronger. Opener-only scope and the pattern list are heuristic`,
            child,
            'page-opens-with-doc-description',
          );
          return;
        }
      }
      return;
    }
    // First non-heading, non-metadata content is not a paragraph — skip.
    return;
  }
}

// Personalization: flag third-person descriptions of the reader anywhere
// in the tutorial body. We walk all paragraphs, emitting at most one
// warning per unique pattern per file to avoid spam.
function validateThirdPersonReader(file: VFileLike, tree: Node) {
  const seenPatterns = new Set<string>();
  const walk = (node: Node) => {
    if (node.type === 'code' || node.type === 'inlineCode') return;
    if (node.type === 'paragraph') {
      const text = collectText(node);
      for (const { pattern, label } of THIRD_PERSON_READER_PATTERNS) {
        if (seenPatterns.has(label)) continue;
        if (pattern.test(text)) {
          seenPatterns.add(label);
          emitNote(
            file,
            `Text describes the reader in third person ("${label}"); Personalization benefits from second-person direct address ("〜しましょう" / "確認してください"). Pattern list is heuristic — legitimate use exists when quoting or defining a role`,
            node,
            'third-person-reader',
          );
        }
      }
      return;
    }
    if (hasChildren(node)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(tree);
}

// Coherence: flag decorative emoji outside of Checkpoint/Reference
// cueing positions. A single emoji anywhere else likely indicates
// decorative use rather than deliberate signaling.
function validateDecorativeEmoji(file: VFileLike, tree: Node) {
  const walk = (node: Node, insideSignalSurface: boolean) => {
    if (node.type === 'code' || node.type === 'inlineCode') return;
    const isSignalSurface =
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      ['Checkpoint', 'Reference', 'Recovery'].includes((node as MdxJsxElement).name ?? '');
    const nextInside = insideSignalSurface || isSignalSurface;

    if (!nextInside && (node.type === 'text' || node.type === 'paragraph')) {
      const text = node.type === 'text' ? (node as TextNode).value : collectText(node);
      // Strip explicitly allowed signal emoji before scanning.
      const stripped = text.replace(new RegExp(ALLOWED_SIGNAL_EMOJI, 'gu'), '');
      const match = DECORATIVE_EMOJI_PATTERN.exec(stripped);
      if (match) {
        emitNote(
          file,
          `Decorative emoji "${match[0]}" outside a signaling surface (Checkpoint/Reference/Recovery); Coherence suggests removing ornamental elements unrelated to the learning objective. Allowlist is a cultural convention, so treat as advisory`,
          node,
          'decorative-emoji',
        );
        return;
      }
    }
    if (hasChildren(node)) {
      for (const child of node.children) walk(child, nextInside);
    }
  };
  walk(tree, false);
}

function validateCheckpointPlacement(file: VFileLike, step: StepContext) {
  if (step.checkpoints.length === 0) {
    return;
  }
  if (step.checkpoints.length > 1) {
    emitWarning(
      file,
      'Step contains multiple <Checkpoint> elements; exactly one <Checkpoint> per Step is the intended structure',
      step.checkpoints[1].node,
      'checkpoint-placement',
    );
  }

  // The Checkpoint must be the last meaningful child of the Step Section.
  const checkpoint = step.checkpoints[0];
  const stepChildren = step.section.children;

  // Find the index of this checkpoint within the Step children (it may be a
  // direct child, or the Checkpoint may have been found during nested walk).
  const directIndex = stepChildren.indexOf(checkpoint.node);
  if (directIndex < 0) {
    // Checkpoint is not a direct child of the Step Section — that means the
    // Step placed it inside a subsection, which is itself a placement error.
    emitWarning(
      file,
      '<Checkpoint> should be a direct child of its top-level <Section> (Step), not nested inside a sub-Section',
      checkpoint.node,
      'checkpoint-placement',
    );
    return;
  }

  // Scan children after the Checkpoint: anything non-trivial means it is not last.
  for (let i = directIndex + 1; i < stepChildren.length; i += 1) {
    const following = stepChildren[i];
    if (following.type === 'text' && /^\s*$/.test((following as TextNode).value)) continue;
    // Allow closing whitespace/paragraphs only.
    if (following.type === 'paragraph' && hasChildren(following)) {
      const text = collectText(following).trim();
      if (text.length === 0) continue;
    }
    emitWarning(
      file,
      '<Checkpoint> should be the last element of its Step; move any content that follows it before the Checkpoint or into a separate Step',
      checkpoint.node,
      'checkpoint-placement',
    );
    return;
  }
}

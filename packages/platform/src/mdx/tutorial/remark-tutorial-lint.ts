import fs from 'node:fs';
import path from 'node:path';
import type { Node } from 'unist';

/**
 * Remark plugin that lints `<Section>` / `<Action>` / `<Verify>` /
 * `<QuickCheck>` / `<Checkpoint>` / `<Exercise>` / `<Reference>` usage for
 * conventions defined in the `tutorial-authoring` skill. Machine-checkable
 * conventions live here (rather than in the skill text) per the `rule-system`
 * mechanisation rule.
 *
 * Severity policy:
 *  - error: structural break that makes the MDX incoherent or loses
 *           required authoring metadata. Blocks the build.
 *  - warn : actionable authoring convention or technical issue.
 *  - note : advisory review prompt or heuristic pattern. Printed as
 *           console.info, never escalated to error even under
 *           TUTORIAL_LINT_STRICT.
 *           Notes surface in collect-all output but do not by
 *           themselves fail the build.
 *
 * Rules implemented:
 *  - tutorial/section-goal-required       error — top-level Section metadata
 *  - tutorial/action-single-image         note  — multiple images merit review
 *  - tutorial/section-no-hrule            warn  — structure convention
 *  - tutorial/verify-no-duplicate-arrow   warn  — render bug
 *  - tutorial/verify-shot-action-role     warn  — Verify shot role mismatch
 *  - tutorial/section-lacks-closure       warn  — Action without aligned closure
 *  - tutorial/section-goal-tense          note  — heuristic endings
 *  - tutorial/reference-image-only        note  — image-role advisory
 *  - tutorial/action-bold-overuse         note  — signaling advisory
 *  - tutorial/third-person-reader         note  — local prose convention
 *  - tutorial/page-opens-with-doc-description note — opener convention
 *  - tutorial/verify-internal-mechanics   note  — pattern list heuristic
 *  - tutorial/concept-length              note  — review advisory
 *  - tutorial/concept-placement           note  — first-use judgement
 *  - tutorial/decorative-emoji            note  — allowlist heuristic
 *  - tutorial/verify-visual-workaround-as-action note — pattern heuristic
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

// ─── Tutorial shot manifest helpers ──────────────────────────────────────────

type ShotAnnotation = { role?: 'verify' | 'action' };
type ShotManifest = { annotations?: ShotAnnotation[] };

/**
 * Derives the .shot.json path from an img attribute value of the form
 * "./img/<stem>.<ext>" → "<mdxDir>/shots/<stem>.shot.json".
 * Returns null when the format does not match.
 */
const deriveShotJsonPath = (mdxDir: string, imgAttr: string): string | null => {
  const m = /^\.\/img\/(.+)\.[^.]+$/.exec(imgAttr);
  if (!m) return null;
  return path.join(mdxDir, 'shots', `${m[1]}.shot.json`);
};

/**
 * Reads a .shot.json manifest synchronously. Returns null when the file does
 * not exist or cannot be parsed (both are non-error conditions at lint time).
 */
const readShotManifest = (shotPath: string): ShotManifest | null => {
  try {
    return JSON.parse(fs.readFileSync(shotPath, 'utf-8')) as ShotManifest;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────

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

// Signaling dilution: too many bold spans in one Action.
// The specific numeric threshold has no direct empirical backing —
// Mayer's Signaling principle says "signal the important" but not a
// quantity. Set to 5: legitimate signaling surfaces (key-row tables,
// 2-3 numbered callouts plus a typed value) stay under this; 6+ bold
// spans is in "obviously diluted" territory where even without research
// the practitioner can flag it. Emitted as a note, not an error.
const ACTION_BOLD_MAX = 5;

// Local learner-facing prose quality convention: flag author-facing
// audience descriptions that do not help the reader perform the task.
const THIRD_PERSON_READER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /受講者/, label: '受講者' },
  { pattern: /学習者(は|が|の)/, label: '学習者は/が/の' },
  { pattern: /初学者向け/, label: '初学者向け' },
  { pattern: /初心者向け/, label: '初心者向け' },
];

// Page-opening patterns for the local convention that prefers
// learner-facing task prose.
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

// Six or more sentences prompt review for multiple concepts or detail
// that belongs in Reference material; this is advisory, not a hard limit.
const CONCEPT_SENTENCE_MAX = 5;

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

const ACTION_COMPONENT_NAMES = new Set(['Action']);
const CLOSURE_COMPONENT_NAMES = new Set(['Verify', 'QuickCheck', 'Checkpoint', 'Exercise']);

// Search the current Section and its wrappers without attributing nested
// Section content to its parent.
const containsSectionLocalComponent = (
  section: MdxJsxElement,
  names: ReadonlySet<string>,
): boolean => {
  const walk = (node: Node): boolean => {
    if (isJsxElement(node, 'Section')) return false;
    if (
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      names.has((node as MdxJsxElement).name ?? '')
    ) {
      return true;
    }
    return hasChildren(node) && node.children.some(walk);
  };
  return section.children.some(walk);
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

const hasTopLevelSection = (tree: Node): boolean =>
  hasChildren(tree) && tree.children.some((child) => isJsxElement(child, 'Section'));

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

export default function remarkTutorialLint() {
  return function transform(tree: Node, file: VFileLike) {
    if (isCollectMode()) startCollection(file);

    // Page-level checks that need the full tree root.
    if (hasTopLevelSection(tree)) {
      validatePageOpener(file, tree);
      validateThirdPersonReader(file, tree);
      validateDecorativeEmoji(file, tree);
      validatePrerequisitesPlacement(file, tree);
      validateNextStepsPlacement(file, tree);
    }

    const walk = (node: Node, sectionDepth: number) => {
      if (!hasChildren(node)) return;

      // Track horizontal rule placement inside any <Section>.
      if (isJsxElement(node, 'Section')) {
        for (const child of node.children) {
          if (child.type === 'thematicBreak') {
            emitWarning(
              file,
              '<Section> should not contain a horizontal rule (`---`); use it only between top-level Sections',
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
          const hasGoal = goal !== undefined && goal.trim().length > 0;
          if (sectionDepth === 0 && !hasGoal) {
            emitError(
              file,
              'Top-level <Section> is missing a non-empty `goal` prop',
              child,
              'section-goal-required',
            );
          } else if (hasGoal && GOAL_PAST_TENSE.test(goal)) {
            emitNote(
              file,
              `<Section goal="..."> uses past/completed form ("${goal}"); consider future-declarative form (e.g. "〜します" / "〜できるようになります"). Specific ending patterns are heuristic, so this is advisory only`,
              child,
              'section-goal-tense',
            );
          }

          walk(child, sectionDepth + 1);
          validateSectionClosure(file, child);
          continue;
        }

        if (isJsxElement(child, 'Action')) {
          validateAction(file, child);
        }

        if (isJsxElement(child, 'Verify')) {
          validateVerify(file, child, file.path);
        }

        if (isJsxElement(child, 'Reference')) {
          validateReference(file, child);
        }

        if (isJsxElement(child, 'Concept')) {
          validateConcept(file, child, node.children, i);
        }

        walk(child, sectionDepth);
      }
    };

    walk(tree, 0);

    // Collect-all mode: throw one aggregated error listing every finding.
    flushCollection(file);
  };
}

function validateAction(file: VFileLike, node: MdxJsxElement) {
  const imgAttr = getStringAttribute(node, 'img');
  const imageCount = countImages(node) + (imgAttr ? 1 : 0);

  if (imageCount > 1) {
    emitNote(
      file,
      '<Action> contains multiple images; review whether one annotated composite image or multiple Actions would reduce integration effort',
      node,
      'action-single-image',
    );
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

function validateVerify(file: VFileLike, node: MdxJsxElement, vfilePath?: string) {
  // ── verify-shot-action-role ───────────────────────────────────────────────
  // A <Verify img="..."> shot must not have role="action" annotations in its
  // .shot.json manifest. Verify screenshots show expected *result* state only;
  // action markers (orange solid boxes) belong in <Action> shots.
  const imgAttr = getStringAttribute(node, 'img');
  if (imgAttr && vfilePath) {
    const mdxDir = path.dirname(vfilePath);
    const shotPath = deriveShotJsonPath(mdxDir, imgAttr);
    if (shotPath) {
      const manifest = readShotManifest(shotPath);
      if (manifest) {
        const hasActionRole = (manifest.annotations ?? []).some((a) => a.role === 'action');
        if (hasActionRole) {
          emitWarning(
            file,
            `<Verify img="${imgAttr}"> の .shot.json にアクション（role="action"）のアノテーションが含まれています。Verify 画像には確認（role="verify"、白い破線）のみ使用できます。/dev/tutorial-shots/ でショットを開いてロールを修正してください`,
            node,
            'verify-shot-action-role',
          );
        }
      }
    }
  }

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
      '<Reference> contains only an image; consider its role: an operation visual may belong in <Action>, an observable result in <Verify>, and lookup material in <Reference> with a text equivalent or context',
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
  // Review Concepts that may combine several ideas or reference detail.
  const body = collectText(node);
  const sentenceCount = countJapaneseSentences(body);
  const tableCount = countTables(node);

  if (sentenceCount > CONCEPT_SENTENCE_MAX) {
    emitNote(
      file,
      `<Concept> has ${sentenceCount} sentences; review whether multiple concepts are combined or details belong in <Reference>. Six sentences is an advisory, not a hard limit`,
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

  // Keep Concepts near an Action or closure that uses the term.
  let foundUsageSite = false;
  for (let j = indexInParent + 1; j < siblings.length; j += 1) {
    const sibling = siblings[j];
    if (
      (sibling.type === 'mdxJsxFlowElement' || sibling.type === 'mdxJsxTextElement') &&
      ['Action', 'Procedure', 'Section', 'Verify', 'QuickCheck', 'Exercise'].includes(
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
      '<Concept> has no following Action/Section/Verify/QuickCheck/Exercise that uses the term in its parent; place it near a first-use or retrieval opportunity when useful. This is a judgement, and a trailing summary may be intentional',
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
      ['Action', 'Procedure', 'Section', 'Verify', 'QuickCheck', 'Exercise'].includes(
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

function validateSectionClosure(file: VFileLike, section: MdxJsxElement) {
  if (!containsSectionLocalComponent(section, ACTION_COMPONENT_NAMES)) return;
  if (containsSectionLocalComponent(section, CLOSURE_COMPONENT_NAMES)) return;
  emitWarning(
    file,
    '<Section> contains an <Action> but no aligned closure; consider <Verify> / <QuickCheck> / <Checkpoint> / <Exercise> when one can test the learning goal',
    section,
    'section-lacks-closure',
  );
}

// Prefer learner-facing task prose in the page opener as a local convention.
// We inspect the first non-empty paragraph outside of any JSX wrapper.
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
            `Page opens with a document-describing sentence ("${text.slice(0, 30)}..."); prefer learner-facing task prose as a local convention, such as opening with an action or goal. Opener-only scope and the pattern list are heuristic`,
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

// Apply the local learner-facing prose quality convention to paragraphs,
// emitting at most one note per unique pattern per file.
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
            `Text uses author-facing audience wording ("${label}"); revise it into learner-facing task prose when the wording does not help perform the task. This is a local prose quality convention; the pattern list is heuristic`,
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

/**
 * Warn if <Prerequisites> appears after a <Section> (it should be at the page top).
 * Severity: warn — placement before first Section has solid pedagogical rationale
 * (ISO 26514 §10 preliminary information; ミニマリズム P1 action-orientation).
 */
function validatePrerequisitesPlacement(file: VFileLike, tree: Node) {
  if (!hasChildren(tree)) return;

  let firstSectionIndex = -1;
  for (let i = 0; i < tree.children.length; i += 1) {
    if (isJsxElement(tree.children[i], 'Section')) {
      firstSectionIndex = i;
      break;
    }
  }

  for (let i = 0; i < tree.children.length; i += 1) {
    const child = tree.children[i];
    if (isJsxElement(child, 'Prerequisites')) {
      if (firstSectionIndex >= 0 && i > firstSectionIndex) {
        emitWarning(
          file,
          '<Prerequisites> should appear before the first <Section>; learners need to verify requirements before starting',
          child,
          'prerequisites-placement',
        );
      }
    }
  }
}

/**
 * Note if <NextSteps> appears before the last <Section> or is absent.
 * Severity: note — presence and placement are advisory (not all tutorials
 * need next-steps guidance).
 */
function validateNextStepsPlacement(file: VFileLike, tree: Node) {
  if (!hasChildren(tree)) return;

  let lastSectionIndex = -1;
  const nextStepsIndices: number[] = [];

  for (let i = 0; i < tree.children.length; i += 1) {
    const child = tree.children[i];
    if (isJsxElement(child, 'Section')) lastSectionIndex = i;
    if (isJsxElement(child, 'NextSteps')) nextStepsIndices.push(i);
  }

  for (const nsIndex of nextStepsIndices) {
    if (lastSectionIndex >= 0 && nsIndex < lastSectionIndex) {
      emitNote(
        file,
        '<NextSteps> appears before the last <Section>; typically it belongs at the very end of the tutorial',
        tree.children[nsIndex],
        'nextsteps-placement',
      );
    }
  }
}

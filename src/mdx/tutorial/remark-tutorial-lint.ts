import type { Node } from 'unist';

/**
 * Remark plugin that lints `<Section>` / `<Action>` / `<Verify>` /
 * `<Reference>` / `<Checkpoint>` usage for the conventions defined in the
 * `tutorial-authoring` skill. Machine-checkable conventions live here
 * (rather than in the skill text) per the `rule-system` mechanisation
 * rule.
 *
 * Rules implemented:
 *
 *  - tutorial/section-goal-required  (error)
 *  - tutorial/section-goal-tense     (error)
 *  - tutorial/action-single-image    (error)
 *  - tutorial/section-no-hrule       (error)
 *  - tutorial/reference-image-only   (warn)
 *  - tutorial/verify-no-duplicate-arrow (warn)
 *  - tutorial/checkpoint-placement   (error)
 *  - tutorial/action-positional-prefix (warn)
 *
 * Severity handling:
 *  - Errors call `file.fail()` which throws and fails the MDX compile.
 *  - Warnings call `file.message()` AND emit `console.warn(...)` so they
 *    surface in both `npm run dev` and `npm run build` output regardless
 *    of the loader's vfile-message handling.
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

const emitWarning = (file: VFileLike, reason: string, place: Node, ruleId: string) => {
  const origin = `${RULE_ORIGIN}:${ruleId}`;
  file.message(reason, place, origin);
  const where = file.path ?? 'unknown';

  console.warn(`[tutorial-lint] ${where}: ${reason} (${ruleId})`);
};

const emitError = (file: VFileLike, reason: string, place: Node, ruleId: string) => {
  const origin = `${RULE_ORIGIN}:${ruleId}`;
  // `file.fail` throws; construct the full origin so consumers can filter.
  file.fail(`${reason} (${ruleId})`, place, origin);
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
    const walk = (node: Node, stepContext: StepContext | null, sectionDepth: number) => {
      if (!hasChildren(node)) return;

      // Track horizontal rule placement inside any <Section>.
      if (isJsxElement(node, 'Section')) {
        for (const child of node.children) {
          if (child.type === 'thematicBreak') {
            emitError(
              file,
              '<Section> must not contain a horizontal rule (`---`); use it only between top-level Steps',
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
            emitError(
              file,
              `<Section goal="..."> uses past/completed form ("${goal}"); use future-declarative form (e.g. "〜します" / "〜できるようになります")`,
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
}

function validateReference(file: VFileLike, node: MdxJsxElement) {
  if (isReferenceImageOnly(node)) {
    emitWarning(
      file,
      '<Reference> contains only an image; success-verifying screenshots belong in an always-visible <Action>, not a collapsible <Reference>',
      node,
      'reference-image-only',
    );
  }
}

function validateCheckpointPlacement(file: VFileLike, step: StepContext) {
  if (step.checkpoints.length === 0) {
    return;
  }
  if (step.checkpoints.length > 1) {
    emitError(
      file,
      'Step contains multiple <Checkpoint> elements; exactly one <Checkpoint> per Step is allowed',
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
    emitError(
      file,
      '<Checkpoint> must be a direct child of its top-level <Section> (Step), not nested inside a sub-Section',
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
    emitError(
      file,
      '<Checkpoint> must be the last element of its Step; move any content that follows it before the Checkpoint or into a separate Step',
      checkpoint.node,
      'checkpoint-placement',
    );
    return;
  }
}

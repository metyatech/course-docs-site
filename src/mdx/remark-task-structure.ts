import type { Node } from 'unist';

type Parent = Node & { children: Node[] };

type MdxJsxElement = Node & {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  children: Node[];
};

type VFileLike = {
  path?: string;
  fail: (reason: string, place?: unknown, origin?: string) => never;
};

type TaskName = 'Exercise' | 'QuickCheck';
type MarkerName = 'Hint' | 'Answer' | 'Solution';
type OrderName = 'problem content' | MarkerName | TaskName | 'content';

const RULE_ORIGIN = 'task-structure';
const TASK_NAMES = new Set<string>(['Exercise', 'QuickCheck']);
const MARKER_NAMES = new Set<string>(['Hint', 'Answer', 'Solution']);
const NEW_EXPECTED_ORDER = 'problem content -> Hint* -> Answer';
const LEGACY_EXPECTED_ORDER = 'problem content -> Solution';

const hasChildren = (node: Node): node is Parent => Array.isArray((node as Parent).children);

const isJsxElement = (node: Node, name?: string): node is MdxJsxElement => {
  if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return false;
  if (!name) return true;
  return (node as MdxJsxElement).name === name;
};

const isTask = (node: Node): node is MdxJsxElement & { name: TaskName } =>
  isJsxElement(node) && TASK_NAMES.has(node.name ?? '');

const isMarker = (node: Node): node is MdxJsxElement & { name: MarkerName } =>
  isJsxElement(node) && MARKER_NAMES.has(node.name ?? '');

const isEmptyOrCommentExpression = (node: Node): boolean => {
  if (node.type !== 'mdxFlowExpression' && node.type !== 'mdxTextExpression') return false;
  const value = ((node as Node & { value?: string }).value ?? '').trim();
  if (value.length === 0) return true;
  return /^\{?\/\*[\s\S]*\*\/\}?$/u.test(value);
};

const isNonSubstantive = (node: Node): boolean => {
  if (node.type === 'text') return /^\s*$/u.test((node as Node & { value?: string }).value ?? '');
  if (isEmptyOrCommentExpression(node)) return true;
  if (node.type === 'paragraph' && hasChildren(node)) {
    return node.children.every(isNonSubstantive);
  }
  if (isJsxElement(node, 'Fragment')) {
    return !hasChildren(node) || node.children.every(isNonSubstantive);
  }
  return false;
};

const substantiveChildren = (node: MdxJsxElement): Node[] =>
  (node.children ?? []).filter((child) => !isNonSubstantive(child));

const hasSubstantiveBody = (node: MdxJsxElement): boolean => substantiveChildren(node).length > 0;

const orderName = (node: Node): OrderName => {
  if (isTask(node)) return node.name;
  if (isMarker(node)) return node.name;
  return 'problem content';
};

const actualOrder = (children: Node[]): string => {
  if (children.length === 0) return '(empty)';
  return children.map(orderName).join(' -> ');
};

const failStructure = (
  file: VFileLike,
  node: Node,
  component: string,
  actual: string,
  expected: string,
  problem: string,
  fix: string,
) => {
  const where = file.path ?? 'unknown file';
  file.fail(
    `${where}: <${component}> invalid task structure: ${problem}. Actual order: ${actual}. Expected order: ${expected}. Fix: ${fix}.`,
    node,
    `${RULE_ORIGIN}:${component}`,
  );
};

const countDirect = (children: Node[], name: string): number =>
  children.filter((child) => isJsxElement(child, name)).length;

const hasDirect = (children: Node[], name: string): boolean => countDirect(children, name) > 0;

const firstMarkerIndex = (children: Node[]): number =>
  children.findIndex((child) => isMarker(child));

function validateNewTask(file: VFileLike, task: MdxJsxElement & { name: TaskName }) {
  const children = substantiveChildren(task);
  const actual = actualOrder(children);
  const expected = NEW_EXPECTED_ORDER;
  const answerCount = countDirect(children, 'Answer');
  const solutionCount = countDirect(children, 'Solution');
  const firstMarker = firstMarkerIndex(children);
  const problemChildren = firstMarker < 0 ? children : children.slice(0, firstMarker);

  if (solutionCount > 0) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      expected,
      task.name === 'QuickCheck'
        ? '<Solution> is legacy-only and cannot appear in <QuickCheck>'
        : '<Solution> cannot be mixed with <Hint>/<Answer>',
      'Use <Answer> for the new structure, or use only one final <Solution> in legacy <Exercise>.',
    );
  }

  if (problemChildren.length === 0) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      expected,
      'problem content is missing before the first Hint or Answer',
      'Add the learner-facing prompt before any <Hint> or <Answer>.',
    );
  }

  if (answerCount !== 1) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      expected,
      answerCount === 0
        ? '<Answer> is missing'
        : `expected exactly one <Answer>, found ${answerCount}`,
      'Add one final <Answer> after all optional <Hint> blocks.',
    );
  }

  let phase: 'problem' | 'hint' | 'answer' = 'problem';
  for (const child of children) {
    const name = orderName(child);
    if (name === 'Answer') {
      phase = 'answer';
      continue;
    }
    if (name === 'Hint') {
      if (phase === 'answer') {
        failStructure(
          file,
          child,
          task.name,
          actual,
          expected,
          '<Hint> appears after <Answer>',
          'Move every <Hint> before the single final <Answer>.',
        );
      }
      phase = 'hint';
      continue;
    }
    if (name === 'Exercise' || name === 'QuickCheck') {
      failStructure(
        file,
        child,
        task.name,
        actual,
        expected,
        `nested <${name}> is not allowed inside <${task.name}>`,
        'Move the nested task outside this task block.',
      );
    }
    if (phase !== 'problem') {
      failStructure(
        file,
        child,
        task.name,
        actual,
        expected,
        phase === 'answer'
          ? 'content appears after <Answer>'
          : 'problem content appears after <Hint>',
        'Keep all problem content before hints, then place hints, then the final answer.',
      );
    }
  }

  for (const child of children) {
    if (
      (isJsxElement(child, 'Hint') || isJsxElement(child, 'Answer')) &&
      !hasSubstantiveBody(child)
    ) {
      failStructure(
        file,
        child,
        task.name,
        actual,
        expected,
        `<${child.name}> is empty`,
        `Add useful content inside <${child.name}> or remove the empty block.`,
      );
    }
  }
}

function validateLegacyExercise(file: VFileLike, task: MdxJsxElement & { name: 'Exercise' }) {
  const children = substantiveChildren(task);
  const actual = actualOrder(children);
  const solutionCount = countDirect(children, 'Solution');
  const solutionIndex = children.findIndex((child) => isJsxElement(child, 'Solution'));
  const problemChildren = solutionIndex < 0 ? children : children.slice(0, solutionIndex);

  if (solutionCount !== 1) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      LEGACY_EXPECTED_ORDER,
      `legacy <Exercise> must have exactly one direct <Solution>, found ${solutionCount}`,
      'Use one final <Solution>, or migrate to <Hint>/<Answer> without <Solution>.',
    );
  }

  if (problemChildren.length === 0) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      LEGACY_EXPECTED_ORDER,
      'problem content is missing before <Solution>',
      'Add the learner-facing prompt before the final <Solution>.',
    );
  }

  if (solutionIndex !== children.length - 1) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      LEGACY_EXPECTED_ORDER,
      '<Solution> must be the final direct child',
      'Move any content that follows <Solution> before it, or migrate to <Answer>.',
    );
  }
}

function validateExercise(file: VFileLike, task: MdxJsxElement & { name: 'Exercise' }) {
  const children = substantiveChildren(task);
  const actual = actualOrder(children);
  const hasHintOrAnswer = hasDirect(children, 'Hint') || hasDirect(children, 'Answer');
  const hasSolution = hasDirect(children, 'Solution');

  if (hasHintOrAnswer && hasSolution) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      NEW_EXPECTED_ORDER,
      '<Exercise> mixes legacy <Solution> with new <Hint>/<Answer>',
      'Use either new <Hint>/<Answer> structure or legacy <Solution>, not both.',
    );
  }

  if (hasHintOrAnswer) {
    validateNewTask(file, task);
    return;
  }

  if (hasSolution) {
    validateLegacyExercise(file, task);
    return;
  }

  if (children.length === 0) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      'problem content, optionally followed by Hint* -> Answer',
      'problem content is missing',
      'Add the learner-facing prompt inside <Exercise>.',
    );
  }
}

function validateDirectPlacement(
  file: VFileLike,
  node: MdxJsxElement,
  parent: Node | null,
  currentTask: MdxJsxElement | null,
) {
  if (node.name === 'Hint' || node.name === 'Answer') {
    if (!currentTask || parent !== currentTask) {
      failStructure(
        file,
        node,
        node.name,
        node.name,
        NEW_EXPECTED_ORDER,
        `<${node.name}> must be a direct child of <Exercise> or <QuickCheck>`,
        `Move <${node.name}> directly inside the task block after the problem content.`,
      );
    }
  }

  if (node.name === 'Solution') {
    if (!currentTask || currentTask.name !== 'Exercise' || parent !== currentTask) {
      failStructure(
        file,
        node,
        node.name,
        node.name,
        LEGACY_EXPECTED_ORDER,
        '<Solution> is allowed only as a direct child of legacy <Exercise>',
        'Move <Solution> directly inside <Exercise>, migrate to <Answer>, or remove it.',
      );
    }
  }
}

export default function remarkTaskStructure() {
  return function transform(tree: Node, file: VFileLike) {
    const walk = (node: Node, parent: Node | null, currentTask: MdxJsxElement | null) => {
      if (isJsxElement(node) && MARKER_NAMES.has(node.name ?? '')) {
        validateDirectPlacement(file, node, parent, currentTask);
      }

      if (isTask(node)) {
        if (currentTask) {
          failStructure(
            file,
            node,
            currentTask.name ?? 'Task',
            node.name,
            currentTask.name === 'QuickCheck' ? NEW_EXPECTED_ORDER : 'one task block at a time',
            `nested <${node.name}> is not allowed inside <${currentTask.name}>`,
            'Move the nested task outside the current task block.',
          );
        }

        if (node.name === 'QuickCheck') {
          validateNewTask(file, node);
        } else if (node.name === 'Exercise') {
          validateExercise(file, node as MdxJsxElement & { name: 'Exercise' });
        }

        if (hasChildren(node)) {
          for (const child of node.children) walk(child, node, node);
        }
        return;
      }

      if (hasChildren(node)) {
        for (const child of node.children) walk(child, node, currentTask);
      }
    };

    walk(tree, null, null);
  };
}

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
type MarkerName = 'Hint' | 'Answer';

const RULE_ORIGIN = 'task-structure';
const TASK_NAMES = new Set<string>(['Exercise', 'QuickCheck']);
const MARKER_NAMES = new Set<string>(['Hint', 'Answer']);
const NEW_EXPECTED_ORDER = 'problem content -> Hint+ -> Answer';
const FORBIDDEN_LEGACY_ANSWER_NAME = ['Solu', 'tion'].join('');

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

const orderName = (node: Node): string => {
  if (isTask(node)) return node.name;
  if (isMarker(node)) return node.name;
  if (isJsxElement(node) && node.name === FORBIDDEN_LEGACY_ANSWER_NAME) return node.name;
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

const firstMarkerIndex = (children: Node[]): number =>
  children.findIndex((child) => isMarker(child));

function validateNewTask(file: VFileLike, task: MdxJsxElement & { name: TaskName }) {
  const children = substantiveChildren(task);
  const actual = actualOrder(children);
  const expected = NEW_EXPECTED_ORDER;
  const answerCount = countDirect(children, 'Answer');
  const hintCount = countDirect(children, 'Hint');
  const firstMarker = firstMarkerIndex(children);
  const problemChildren = firstMarker < 0 ? children : children.slice(0, firstMarker);
  const forbiddenLegacyAnswer = children.find(
    (child): child is MdxJsxElement =>
      isJsxElement(child) && child.name === FORBIDDEN_LEGACY_ANSWER_NAME,
  );

  if (forbiddenLegacyAnswer) {
    failForbiddenLegacyAnswer(file, forbiddenLegacyAnswer);
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

  if (hintCount < 1) {
    failStructure(
      file,
      task,
      task.name,
      actual,
      expected,
      'at least one <Hint> is required',
      'Add one or more useful <Hint> blocks before the final <Answer>.',
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

function validateExercise(file: VFileLike, task: MdxJsxElement & { name: 'Exercise' }) {
  validateNewTask(file, task);
}

function failForbiddenLegacyAnswer(file: VFileLike, node: MdxJsxElement) {
  const component = node.name ?? 'legacy answer component';

  failStructure(
    file,
    node,
    component,
    component,
    NEW_EXPECTED_ORDER,
    `<${component}> is no longer supported`,
    'Use <Answer> after optional <Hint> blocks.',
  );
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

  void parent;
  void currentTask;
}

export default function remarkTaskStructure() {
  return function transform(tree: Node, file: VFileLike) {
    const walk = (node: Node, parent: Node | null, currentTask: MdxJsxElement | null) => {
      if (isJsxElement(node) && node.name === FORBIDDEN_LEGACY_ANSWER_NAME) {
        failForbiddenLegacyAnswer(file, node);
      }

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

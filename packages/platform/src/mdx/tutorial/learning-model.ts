export const LEARNING_UNIT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export const LEARNING_EVENT_PHASES = ['initial', 'practice', 'retrieval', 'transfer'] as const;
export const LEARNING_PATTERNS = ['instruction-first', 'problem-solving-first'] as const;
export const EVIDENCE_KINDS = ['application', 'retrieval', 'transfer'] as const;
export const LEARNING_STAGES = ['Instruction', 'ProblemSolving'] as const;

export type LearningEventPhase = (typeof LEARNING_EVENT_PHASES)[number];
export type LearningPattern = (typeof LEARNING_PATTERNS)[number];
export type LearningEventStrategy = 'productive-failure';
export type LearningEventMetadata = {
  eventId?: string;
  targets?: string;
  phase?: LearningEventPhase;
  pattern?: LearningPattern;
  strategy?: LearningEventStrategy;
};

export type LearningUnit = { id: string; objective: string; parent?: string };
export type LearningUnitModel = { version: 1; units: LearningUnit[] };
export type LearningEvent = {
  id: string;
  targets: string[];
  phase: LearningEventPhase;
  pattern?: LearningPattern;
  strategy?: LearningEventStrategy;
  page: string;
  order: number;
};
export type LearningEvidence = {
  targets: string[];
  demonstrates: (typeof EVIDENCE_KINDS)[number];
  page: string;
  eventId: string;
};
export type LearningIssue = { severity: 'error' | 'note'; message: string };
export type LearningContentAnalysis = {
  events: LearningEvent[];
  evidence: LearningEvidence[];
  issues: LearningIssue[];
  metadataPresent: boolean;
};

type AstNode = {
  type?: string;
  name?: string | null;
  value?: unknown;
  attributes?: Array<{ name?: string; value?: unknown }>;
  children?: AstNode[];
};

const isElement = (node: AstNode, name?: string) =>
  (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
  typeof node.name === 'string' &&
  (name === undefined || node.name === name);

const astAttribute = (node: AstNode, name: string) => {
  const value = node.attributes?.find((attribute) => attribute.name === name)?.value;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value)
    return (value as { value?: unknown }).value;
  return undefined;
};

export const parseTargetList = (value: unknown): string[] | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const targets = value.split(',').map((target) => target.trim());
  if (targets.some((target) => target === '') || new Set(targets).size !== targets.length)
    return null;
  return targets;
};

export const validateLearningEvent = (
  input: {
    id: unknown;
    targets: unknown;
    phase: unknown;
    pattern: unknown;
    strategy: unknown;
  },
  page: string,
): LearningIssue[] => {
  const issues: LearningIssue[] = [];
  if (typeof input.id !== 'string' || !LEARNING_UNIT_ID_PATTERN.test(input.id)) {
    issues.push({
      severity: 'error',
      message: `Learning event ID in ${page} must be a lowercase kebab-case stable ID.`,
    });
  }
  const targets = parseTargetList(input.targets);
  if (!targets || targets.some((target) => !LEARNING_UNIT_ID_PATTERN.test(target))) {
    issues.push({
      severity: 'error',
      message: `Event "${String(input.id)}" in ${page} has missing or invalid targets.`,
    });
  }
  if (
    typeof input.phase !== 'string' ||
    !LEARNING_EVENT_PHASES.includes(input.phase as LearningEvent['phase'])
  ) {
    issues.push({
      severity: 'error',
      message: `Event "${String(input.id)}" in ${page} has an invalid phase.`,
    });
  }
  if (input.phase === 'initial' && input.pattern === undefined) {
    issues.push({
      severity: 'error',
      message: `Initial event "${String(input.id)}" in ${page} must declare a learning pattern.`,
    });
  }
  if (input.phase !== 'initial' && input.pattern !== undefined) {
    issues.push({
      severity: 'error',
      message: `Non-initial event "${String(input.id)}" in ${page} cannot declare a learning pattern.`,
    });
  }
  if (
    input.pattern !== undefined &&
    !LEARNING_PATTERNS.some((pattern) => pattern === input.pattern)
  ) {
    issues.push({
      severity: 'error',
      message: `Event "${String(input.id)}" in ${page} has an invalid learning pattern.`,
    });
  }
  if (input.strategy !== undefined && input.strategy !== 'productive-failure') {
    issues.push({
      severity: 'error',
      message: `Event "${String(input.id)}" in ${page} has an unsupported strategy.`,
    });
  }
  if (
    input.strategy === 'productive-failure' &&
    (input.phase !== 'initial' || input.pattern !== 'problem-solving-first')
  ) {
    issues.push({
      severity: 'error',
      message: `Productive Failure event "${String(input.id)}" must use problem-solving-first initial learning.`,
    });
  }
  return issues;
};

const assessmentSurfaces = new Set(['Verify', 'QuickCheck', 'Checkpoint', 'Exercise']);

export const collectLearningContent = (tree: AstNode, page: string): LearningContentAnalysis => {
  const events: LearningEvent[] = [];
  const evidence: LearningEvidence[] = [];
  const issues: LearningIssue[] = [];
  let order = 0;
  let metadataPresent = false;
  const learningEventFields = new Set(['eventId', 'targets', 'phase', 'pattern', 'strategy']);
  const visit = (
    node: AstNode,
    enclosingEvent?: LearningEvent,
    eventOwner?: AstNode,
    stageOrder?: string[],
    parentStage?: string,
    parentNode?: AstNode,
  ) => {
    let currentEvent = enclosingEvent;
    let currentStageOrder = stageOrder;
    let currentEventOwner = eventOwner;
    let ownsEvent = false;
    if (isElement(node, 'Section')) {
      if (node.attributes?.some((attribute) => attribute.name === 'objective')) {
        issues.push({
          severity: 'error',
          message: `Learning objectives belong only in learning-units.yaml, not in ${page}.`,
        });
      }
      const present = (node.attributes ?? [])
        .filter((attribute) => learningEventFields.has(String(attribute.name)))
        .map((attribute) => String(attribute.name));
      if (present.length > 0) metadataPresent = true;
      if (
        present.length > 0 &&
        !['eventId', 'targets', 'phase'].every((name) => present.includes(name))
      ) {
        issues.push({
          severity: 'error',
          message: `<Section> learning events in ${page} require eventId, targets, and phase together.`,
        });
      }
      if (present.length > 0) {
        const id = astAttribute(node, 'eventId');
        const rawTargets = astAttribute(node, 'targets');
        const phase = astAttribute(node, 'phase');
        const pattern = astAttribute(node, 'pattern');
        const strategy = astAttribute(node, 'strategy');
        issues.push(
          ...validateLearningEvent({ id, targets: rawTargets, phase, pattern, strategy }, page),
        );
        if (enclosingEvent) {
          issues.push({
            severity: 'error',
            message: `Learning event "${String(id)}" in ${page} is nested inside event "${enclosingEvent.id}".`,
          });
        }
        const targets = parseTargetList(rawTargets) ?? [];
        const event: LearningEvent = {
          id: typeof id === 'string' ? id : '',
          targets,
          phase: phase as LearningEvent['phase'],
          pattern: pattern as LearningEvent['pattern'],
          strategy: strategy as LearningEvent['strategy'],
          page,
          order: order++,
        };
        events.push(event);
        currentEvent = event;
        currentStageOrder = [];
        currentEventOwner = node;
        ownsEvent = true;
      }
    }
    if (isElement(node, 'Evidence')) metadataPresent = true;
    if (
      isElement(node) &&
      LEARNING_STAGES.includes(node.name as (typeof LEARNING_STAGES)[number])
    ) {
      metadataPresent = true;
      if (!currentEvent)
        issues.push({
          severity: 'error',
          message: `<${node.name}> in ${page} must be inside a learning event.`,
        });
      else if (currentEvent.phase !== 'initial')
        issues.push({
          severity: 'error',
          message: `<${node.name}> in ${page} can only be used inside an initial learning event.`,
        });
      else if (parentStage || parentNode !== currentEventOwner)
        issues.push({
          severity: 'error',
          message: `<${node.name}> in ${page} must be a top-level instructional stage directly inside its initial event Section.`,
        });
      else currentStageOrder?.push(node.name!);
    }
    if (isElement(node, 'Evidence')) {
      const targets = parseTargetList(astAttribute(node, 'targets'));
      const demonstrates = astAttribute(node, 'demonstrates');
      if (!currentEvent)
        issues.push({
          severity: 'error',
          message: `<Evidence> in ${page} is outside a learning event.`,
        });
      if (!targets || targets.some((target) => !LEARNING_UNIT_ID_PATTERN.test(target))) {
        issues.push({
          severity: 'error',
          message: `<Evidence> in ${page} requires valid comma-separated learning unit IDs in targets.`,
        });
      }
      if (
        typeof demonstrates !== 'string' ||
        !EVIDENCE_KINDS.includes(demonstrates as LearningEvidence['demonstrates'])
      ) {
        issues.push({
          severity: 'error',
          message: `<Evidence> in ${page} demonstrates must be application, retrieval, or transfer.`,
        });
      }
      if (currentEvent && targets?.some((target) => !currentEvent!.targets.includes(target))) {
        issues.push({
          severity: 'error',
          message: `<Evidence> in ${page} targets units not declared by event "${currentEvent.id}".`,
        });
      }
      const meaningful = (node.children ?? []).filter(
        (child) => child.type !== 'text' || String(child.value ?? '').trim() !== '',
      );
      if (
        meaningful.length !== 1 ||
        !isElement(meaningful[0] ?? {}) ||
        !assessmentSurfaces.has(String(meaningful[0]?.name))
      ) {
        issues.push({
          severity: 'error',
          message: `<Evidence> in ${page} must directly wrap exactly one Verify, QuickCheck, Checkpoint, or Exercise surface.`,
        });
      }
      if (
        currentEvent &&
        targets &&
        typeof demonstrates === 'string' &&
        EVIDENCE_KINDS.includes(demonstrates as LearningEvidence['demonstrates'])
      ) {
        evidence.push({
          targets,
          demonstrates: demonstrates as LearningEvidence['demonstrates'],
          page,
          eventId: currentEvent.id,
        });
      }
    }
    for (const child of node.children ?? [])
      visit(
        child,
        currentEvent,
        currentEventOwner,
        currentStageOrder,
        isElement(node) && LEARNING_STAGES.includes(node.name as (typeof LEARNING_STAGES)[number])
          ? node.name!
          : parentStage,
        node,
      );
    if (ownsEvent && currentEvent) {
      const sequence = currentStageOrder ?? [];
      if (
        currentEvent.pattern === 'instruction-first' &&
        !(
          sequence.indexOf('Instruction') >= 0 &&
          sequence.indexOf('ProblemSolving') > sequence.indexOf('Instruction')
        )
      ) {
        issues.push({
          severity: 'error',
          message: `Event "${currentEvent.id}" in ${page} declares instruction-first but must contain <Instruction> before <ProblemSolving>.`,
        });
      }
      if (
        currentEvent.pattern === 'problem-solving-first' &&
        !(
          sequence.indexOf('ProblemSolving') >= 0 &&
          sequence.indexOf('Instruction') > sequence.indexOf('ProblemSolving')
        )
      ) {
        issues.push({
          severity: 'error',
          message: `Event "${currentEvent.id}" in ${page} declares problem-solving-first but must contain <ProblemSolving> before <Instruction>.`,
        });
      }
      if (
        currentEvent.strategy === 'productive-failure' &&
        !(
          sequence.indexOf('ProblemSolving') >= 0 &&
          sequence.indexOf('Instruction') > sequence.indexOf('ProblemSolving')
        )
      ) {
        issues.push({
          severity: 'error',
          message: `Productive Failure event "${currentEvent.id}" in ${page} needs a <ProblemSolving> stage followed by an <Instruction> stage.`,
        });
      }
    }
  };
  visit(tree);
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.id))
      issues.push({
        severity: 'error',
        message: `Duplicate learning event ID "${event.id}" in ${page}.`,
      });
    ids.add(event.id);
  }
  return { events, evidence, issues, metadataPresent };
};

export const validateLearningUnitModel = (input: unknown): LearningIssue[] => {
  const issues: LearningIssue[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return [{ severity: 'error', message: 'learning-units.yaml must contain an object.' }];
  const model = input as Partial<LearningUnitModel>;
  if (model.version !== 1)
    issues.push({ severity: 'error', message: 'Learning unit model version must be 1.' });
  if (!Array.isArray(model.units) || model.units.length === 0)
    return [
      ...issues,
      { severity: 'error', message: 'Learning unit model must contain a non-empty units array.' },
    ];
  const ids = new Set<string>();
  for (const [index, candidate] of model.units.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      issues.push({ severity: 'error', message: `units[${index}] must be an object.` });
      continue;
    }
    const unit = candidate as LearningUnit;
    if (typeof unit.id !== 'string' || !LEARNING_UNIT_ID_PATTERN.test(unit.id))
      issues.push({
        severity: 'error',
        message: `units[${index}].id must be a lowercase kebab-case stable ID.`,
      });
    else if (ids.has(unit.id))
      issues.push({ severity: 'error', message: `Duplicate learning unit ID "${unit.id}".` });
    else ids.add(unit.id);
    if (typeof unit.objective !== 'string' || unit.objective.trim() === '')
      issues.push({
        severity: 'error',
        message: `Learning unit "${unit.id ?? index}" needs non-empty objective text.`,
      });
    if (
      unit.parent !== undefined &&
      (typeof unit.parent !== 'string' || !LEARNING_UNIT_ID_PATTERN.test(unit.parent))
    )
      issues.push({
        severity: 'error',
        message: `Learning unit "${unit.id ?? index}" has an invalid parent ID.`,
      });
  }
  const units = new Map(
    model.units
      .filter((item): item is LearningUnit =>
        Boolean(item && typeof item === 'object' && typeof item.id === 'string'),
      )
      .map((item) => [item.id, item]),
  );
  for (const unit of units.values()) {
    if (unit.parent && !ids.has(unit.parent))
      issues.push({
        severity: 'error',
        message: `Learning unit "${unit.id}" references unknown parent "${unit.parent}".`,
      });
    const visited = new Set([unit.id]);
    let parent = unit.parent;
    while (parent && units.has(parent)) {
      if (visited.has(parent)) {
        issues.push({
          severity: 'error',
          message: `Learning unit hierarchy contains a cycle through "${parent}".`,
        });
        break;
      }
      visited.add(parent);
      parent = units.get(parent)?.parent;
    }
  }
  return issues;
};

export const analyzeLearningProgression = ({
  units,
  events,
  evidence,
}: {
  units: LearningUnit[];
  events: LearningEvent[];
  evidence: LearningEvidence[];
}) => {
  const knownIds = new Set(units.map((unit) => unit.id));
  const issues: LearningIssue[] = [];
  const eventIds = new Set<string>();
  const eventRows = new Map(
    units.map((unit) => [unit.id, { initial: 0, evidence: new Set<string>() }]),
  );
  for (const event of events) {
    if (eventIds.has(event.id))
      issues.push({
        severity: 'error',
        message: `Duplicate learning event ID "${event.id}" across course pages.`,
      });
    eventIds.add(event.id);
    for (const target of event.targets) {
      if (!knownIds.has(target)) {
        issues.push({
          severity: 'error',
          message: `Event "${event.id}" targets unknown learning unit "${target}".`,
        });
        continue;
      }
      if (event.phase === 'initial') eventRows.get(target)!.initial += 1;
    }
  }
  for (const item of evidence) {
    for (const target of item.targets) {
      if (!knownIds.has(target))
        issues.push({
          severity: 'error',
          message: `Evidence on "${item.page}" targets unknown learning unit "${target}".`,
        });
      else eventRows.get(target)!.evidence.add(item.demonstrates);
    }
  }
  const descendants = new Map(units.map((unit) => [unit.id, [] as string[]]));
  for (const unit of units)
    if (unit.parent && descendants.has(unit.parent)) descendants.get(unit.parent)!.push(unit.id);
  const allDescendants = (id: string): string[] =>
    (descendants.get(id) ?? []).flatMap((child) => [child, ...allDescendants(child)]);
  const progression = units.map((unit) => {
    const encounters = events.filter((event) => event.targets.includes(unit.id));
    const introductions = encounters.filter((event) => event.phase === 'initial');
    const laterRecurrence = encounters.filter((event) => event.phase !== 'initial');
    const children = descendants.get(unit.id) ?? [];
    const composite = children.length > 0;
    if (!composite && introductions.length > 1)
      issues.push({
        severity: 'error',
        message: `Leaf learning unit "${unit.id}" has multiple initial introductions (${introductions.map((event) => event.id).join(', ')}).`,
      });
    if (!composite && encounters.length === 0)
      issues.push({
        severity: 'error',
        message: `Leaf learning unit "${unit.id}" has no learning event.`,
      });
    if (!composite && eventRows.get(unit.id)!.evidence.size === 0)
      issues.push({
        severity: 'note',
        message: `Leaf learning unit "${unit.id}" has no explicit evidence.`,
      });
    const descendantIds = allDescendants(unit.id);
    const descendantEvents = events.filter((event) =>
      event.targets.some((target) => descendantIds.includes(target)),
    );
    const unitEvidence = evidence.filter((item) => item.targets.includes(unit.id));
    const directEvidence = [...eventRows.get(unit.id)!.evidence].sort();
    const descendantEvidence = [
      ...new Set(
        evidence
          .filter((item) => item.targets.some((target) => descendantIds.includes(target)))
          .map((item) => item.demonstrates),
      ),
    ].sort();
    return {
      id: unit.id,
      objective: unit.objective,
      parent: unit.parent ?? null,
      kind: composite ? 'composite' : 'leaf',
      children,
      directCoverage: { events: encounters.length, evidence: directEvidence },
      descendantCoverage: composite
        ? {
            units: descendantIds.length,
            events: descendantEvents.length,
            evidence: descendantEvidence,
          }
        : null,
      events: encounters.map(({ id, page, phase }) => ({ id, page, phase })),
      initialIntroductions: introductions.map(({ id, page }) => ({ id, page })),
      laterRecurrence: laterRecurrence.map(({ id, page, phase }) => ({ id, page, phase })),
      evidence: directEvidence,
      evidenceSites: unitEvidence.map(({ demonstrates, page, eventId }) => ({
        demonstrates,
        page,
        eventId,
      })),
    };
  });
  return {
    issues,
    progression,
    events: [...events].sort((a, b) => a.order - b.order),
  };
};

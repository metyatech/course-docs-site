import type { ValidationIssue } from './schema.js';

const stableIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const responseKinds = [
  'recognition',
  'selection',
  'generated-code',
  'execution',
  'explanation',
  'diagnosis',
] as const;
const evidenceDimensions = [
  'independent-performance',
  'assistance-dependence',
  'retention',
  'generalization',
  'calibration',
] as const;
const responseForms = [
  'recognition',
  'selection',
  'code',
  'execution',
  'explanation',
  'diagnosis',
] as const;
const variabilityValues = ['constant', 'variable'] as const;
const formValues = ['required', 'optional', 'not-required'] as const;
const taskDimensionRoles = ['relevant', 'surface', 'variation', 'contrast'] as const;
const evaluatorKinds = ['exact-response', 'css-selector', 'selection-set', 'not-scored'] as const;
const contentKinds = ['text', 'code', 'resource'] as const;

type UnknownRecord = Record<string, unknown>;
type JsonPrimitive = string | number | boolean | null;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonPrimitive = (value: unknown): value is JsonPrimitive =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && allowed.includes(value as T);

const findNonJsonValuePaths = (
  value: unknown,
  path = '$',
  ancestors = new Set<object>(),
): string[] => {
  if (isJsonPrimitive(value)) return [];
  if (typeof value !== 'object' || value === null || ancestors.has(value)) return [path];

  ancestors.add(value);
  const invalidPaths: string[] = [];
  const childPath = (key: string) => (path === '$' ? key : `${path}.${key}`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        invalidPaths.push(`${path}[${index}]`);
        continue;
      }
      invalidPaths.push(
        ...findNonJsonValuePaths(
          descriptor.value,
          `${path === '$' ? '' : path}[${index}]`,
          ancestors,
        ),
      );
    }
    const extraKeys = Reflect.ownKeys(value).filter(
      (key) => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key)),
    );
    for (const key of extraKeys) invalidPaths.push(`${path === '$' ? '' : path}[${String(key)}]`);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidPaths.push(path);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') invalidPaths.push(`${path === '$' ? '' : path}[${String(key)}]`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        invalidPaths.push(childPath(key));
        continue;
      }
      invalidPaths.push(...findNonJsonValuePaths(descriptor.value, childPath(key), ancestors));
    }
  }
  ancestors.delete(value);
  return invalidPaths;
};

const compareCodePointStrings = (left: string, right: string): number => {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
};

const deepEqualJson = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqualJson(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort(compareCodePointStrings);
  const rightKeys = Object.keys(right).sort(compareCodePointStrings);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deepEqualJson(left[key], right[key]))
  );
};

export const validateLearningSourceV2 = (input: unknown): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => {
    issues.push({ severity: 'error', code, path, message });
  };
  const requireObject = (value: unknown, path: string): UnknownRecord | undefined => {
    if (isRecord(value)) return value;
    add('REQUIRED_OBJECT', path, `${path} must be an object.`);
    return undefined;
  };
  const requireString = (
    record: UnknownRecord,
    key: string,
    path: string,
    options: { nonEmpty?: boolean; stableId?: boolean } = {},
  ): string | undefined => {
    const value = record[key];
    if (typeof value !== 'string') {
      add('REQUIRED_STRING', path, `${path} must be a string.`);
      return undefined;
    }
    if (options.nonEmpty && value.trim() === '') {
      add(
        path === 'courseId' ? 'EMPTY_COURSE_ID' : 'EMPTY_CONTENT_REVISION',
        path,
        `${path} must not be empty.`,
      );
    }
    if (options.stableId && !stableIdPattern.test(value)) {
      add('INVALID_STABLE_ID', path, `${path} must use a lowercase kebab-case stable ID.`);
    }
    return value;
  };
  const requireBoolean = (record: UnknownRecord, key: string, path: string) => {
    if (typeof record[key] !== 'boolean')
      add('REQUIRED_BOOLEAN', path, `${path} must be a boolean.`);
  };
  const requireArray = (record: UnknownRecord, key: string, path: string): unknown[] => {
    const value = record[key];
    if (Array.isArray(value)) return value;
    add('REQUIRED_ARRAY', path, `${path} must be an array.`);
    return [];
  };
  const requireEnum = <T extends string>(
    record: UnknownRecord,
    key: string,
    path: string,
    allowed: readonly T[],
  ): T | undefined => {
    const value = record[key];
    if (isOneOf(value, allowed)) return value;
    add('INVALID_ENUM', path, `${path} must be one of: ${allowed.join(', ')}.`);
    return undefined;
  };
  const requireStringArray = (record: UnknownRecord, key: string, path: string): string[] => {
    const values = requireArray(record, key, path);
    const output: string[] = [];
    values.forEach((value, index) => {
      if (typeof value !== 'string')
        add('REQUIRED_STRING', `${path}[${index}]`, `${path}[${index}] must be a string.`);
      else output.push(value);
    });
    return output;
  };
  const validateIdList = (
    record: UnknownRecord,
    key: string,
    path: string,
    known: Set<string>,
    unknownCode: string,
    unknownLabel: string,
  ) => {
    for (const [index, id] of requireStringArray(record, key, path).entries()) {
      if (!stableIdPattern.test(id))
        add(
          'INVALID_STABLE_ID',
          `${path}[${index}]`,
          `${path}[${index}] must be a lowercase kebab-case stable ID.`,
        );
      else if (!known.has(id))
        add(
          unknownCode,
          `${path}[${index}]`,
          `${path}[${index}] references unknown ${unknownLabel} "${id}".`,
        );
    }
  };
  const validateCollectionIds = (rows: unknown[], path: string, idToPath: Map<string, string>) => {
    rows.forEach((candidate, index) => {
      const row = requireObject(candidate, `${path}[${index}]`);
      if (!row) return;
      const id = requireString(row, 'id', `${path}[${index}].id`, { stableId: true });
      if (!id || !stableIdPattern.test(id)) return;
      if (idToPath.has(id))
        add(
          'DUPLICATE_ID',
          `${path}[${index}].id`,
          `ID "${id}" is already declared at ${idToPath.get(id)}.`,
        );
      else idToPath.set(id, `${path}[${index}].id`);
    });
  };

  for (const path of findNonJsonValuePaths(input))
    add('NON_JSON_VALUE', path, `${path} must contain a finite JSON data value.`);
  const source = requireObject(input, '$');
  if (!source) return issues;

  if (source.sourceSchemaVersion !== 1)
    add(
      'UNSUPPORTED_SOURCE_SCHEMA_VERSION',
      'sourceSchemaVersion',
      'sourceSchemaVersion must be 1.',
    );
  requireString(source, 'courseId', 'courseId', { nonEmpty: true, stableId: true });
  requireString(source, 'contentRevision', 'contentRevision', { nonEmpty: true });

  const units = requireArray(source, 'units', 'units');
  const knowledgeComponents = requireArray(source, 'knowledgeComponents', 'knowledgeComponents');
  const evidenceSpecs = requireArray(source, 'evidenceSpecs', 'evidenceSpecs');
  const taskFamilies = requireArray(source, 'taskFamilies', 'taskFamilies');
  const activities = requireArray(source, 'activities', 'activities');
  const corePlan = requireArray(source, 'corePlan', 'corePlan');
  const evaluatorSpecs = requireArray(source, 'evaluatorSpecs', 'evaluatorSpecs');
  const resources = requireArray(source, 'resources', 'resources');

  const ids = {
    units: new Map<string, string>(),
    knowledgeComponents: new Map<string, string>(),
    evidenceSpecs: new Map<string, string>(),
    taskFamilies: new Map<string, string>(),
    activities: new Map<string, string>(),
    corePlan: new Map<string, string>(),
    evaluatorSpecs: new Map<string, string>(),
    resources: new Map<string, string>(),
  };
  validateCollectionIds(units, 'units', ids.units);
  validateCollectionIds(knowledgeComponents, 'knowledgeComponents', ids.knowledgeComponents);
  validateCollectionIds(evidenceSpecs, 'evidenceSpecs', ids.evidenceSpecs);
  validateCollectionIds(taskFamilies, 'taskFamilies', ids.taskFamilies);
  validateCollectionIds(activities, 'activities', ids.activities);
  validateCollectionIds(corePlan, 'corePlan', ids.corePlan);
  validateCollectionIds(evaluatorSpecs, 'evaluatorSpecs', ids.evaluatorSpecs);
  validateCollectionIds(resources, 'resources', ids.resources);

  units.forEach((candidate, index) => {
    const path = `units[${index}]`;
    const row = requireObject(candidate, path);
    if (!row) return;
    requireString(row, 'title', `${path}.title`);
    requireString(row, 'goal', `${path}.goal`);
    validateIdList(
      row,
      'knowledgeComponentIds',
      `${path}.knowledgeComponentIds`,
      new Set(ids.knowledgeComponents.keys()),
      'UNKNOWN_KNOWLEDGE_COMPONENT',
      'Knowledge Component',
    );
  });

  knowledgeComponents.forEach((candidate, index) => {
    const path = `knowledgeComponents[${index}]`;
    const row = requireObject(candidate, path);
    if (!row) return;
    const claim = requireObject(row.claim, `${path}.claim`);
    if (claim) requireString(claim, 'learnerCan', `${path}.claim.learnerCan`);
    const condition = requireObject(row.condition, `${path}.condition`);
    if (condition) {
      requireEnum(condition, 'variability', `${path}.condition.variability`, variabilityValues);
      requireStringArray(condition, 'relevantFeatures', `${path}.condition.relevantFeatures`);
    }
    const response = requireObject(row.response, `${path}.response`);
    if (response) {
      requireEnum(response, 'variability', `${path}.response.variability`, variabilityValues);
      requireEnum(response, 'form', `${path}.response.form`, responseForms);
    }
    const forms = requireObject(row.forms, `${path}.forms`);
    if (forms) {
      requireEnum(forms, 'performance', `${path}.forms.performance`, formValues);
      requireEnum(forms, 'verbal', `${path}.forms.verbal`, formValues);
    }
    const rationale = requireObject(row.rationale, `${path}.rationale`);
    if (rationale) {
      requireBoolean(rationale, 'available', `${path}.rationale.available`);
      requireBoolean(rationale, 'required', `${path}.rationale.required`);
    }
    validateIdList(
      row,
      'prerequisites',
      `${path}.prerequisites`,
      new Set(ids.knowledgeComponents.keys()),
      'UNKNOWN_KNOWLEDGE_COMPONENT',
      'Knowledge Component',
    );
  });

  evidenceSpecs.forEach((candidate, index) => {
    const path = `evidenceSpecs[${index}]`;
    const row = requireObject(candidate, path);
    if (!row) return;
    const target = requireString(
      row,
      'targetKnowledgeComponentId',
      `${path}.targetKnowledgeComponentId`,
      { stableId: true },
    );
    if (target && stableIdPattern.test(target) && !ids.knowledgeComponents.has(target))
      add(
        'UNKNOWN_KNOWLEDGE_COMPONENT',
        `${path}.targetKnowledgeComponentId`,
        `Unknown Knowledge Component "${target}".`,
      );
    const observable = requireObject(row.observable, `${path}.observable`);
    if (observable) {
      requireEnum(observable, 'response', `${path}.observable.response`, responseKinds);
      requireEnum(observable, 'correctness', `${path}.observable.correctness`, [
        'exact',
        'semantic',
        'behavioral',
        'human-review',
        'not-scored',
      ]);
    }
    const supports = requireObject(row.supports, `${path}.supports`);
    if (supports)
      requireEnum(supports, 'dimension', `${path}.supports.dimension`, evidenceDimensions);
    const requires = requireObject(row.requires, `${path}.requires`);
    if (requires) {
      requireEnum(requires, 'assistance', `${path}.requires.assistance`, ['none', 'allowed']);
      requireBoolean(
        requires,
        'freshBeforeAnswerExposure',
        `${path}.requires.freshBeforeAnswerExposure`,
      );
    }
  });

  const evidenceById = new Map<string, UnknownRecord>();
  evidenceSpecs.forEach((candidate) => {
    if (isRecord(candidate) && typeof candidate.id === 'string')
      evidenceById.set(candidate.id, candidate);
  });

  evaluatorSpecs.forEach((candidate, index) => {
    const path = `evaluatorSpecs[${index}]`;
    const row = requireObject(candidate, path);
    if (row) requireEnum(row, 'kind', `${path}.kind`, evaluatorKinds);
  });

  const familyRows = new Map<
    string,
    { row: UnknownRecord; path: string; variants: Map<string, UnknownRecord> }
  >();
  taskFamilies.forEach((candidate, index) => {
    const path = `taskFamilies[${index}]`;
    const row = requireObject(candidate, path);
    if (!row) return;
    const familyId = typeof row.id === 'string' ? row.id : undefined;
    const dimensions = requireObject(row.dimensions, `${path}.dimensions`);
    const dimensionKeys = new Set<string>();
    if (dimensions) {
      for (const [name, dimension] of Object.entries(dimensions)) {
        dimensionKeys.add(name);
        const dimensionRecord = requireObject(dimension, `${path}.dimensions.${name}`);
        if (dimensionRecord)
          requireEnum(
            dimensionRecord,
            'role',
            `${path}.dimensions.${name}.role`,
            taskDimensionRoles,
          );
      }
    }
    validateIdList(
      row,
      'targetKnowledgeComponentIds',
      `${path}.targetKnowledgeComponentIds`,
      new Set(ids.knowledgeComponents.keys()),
      'UNKNOWN_KNOWLEDGE_COMPONENT',
      'Knowledge Component',
    );
    const response = requireObject(row.response, `${path}.response`);
    if (response) requireEnum(response, 'kind', `${path}.response.kind`, responseKinds);
    const evaluatorId = requireString(row, 'evaluatorId', `${path}.evaluatorId`, {
      stableId: true,
    });
    if (evaluatorId && stableIdPattern.test(evaluatorId) && !ids.evaluatorSpecs.has(evaluatorId))
      add('UNKNOWN_EVALUATOR', `${path}.evaluatorId`, `Unknown evaluator "${evaluatorId}".`);
    validateIdList(
      row,
      'canProduceEvidenceIds',
      `${path}.canProduceEvidenceIds`,
      new Set(ids.evidenceSpecs.keys()),
      'UNKNOWN_EVIDENCE_SPEC',
      'EvidenceSpec',
    );
    const targets = Array.isArray(row.targetKnowledgeComponentIds)
      ? row.targetKnowledgeComponentIds
      : [];
    const familyResponse = isRecord(row.response) ? row.response.kind : undefined;
    const producibleEvidenceIds = Array.isArray(row.canProduceEvidenceIds)
      ? row.canProduceEvidenceIds
      : [];
    producibleEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (typeof evidenceId !== 'string') return;
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) return;
      if (
        typeof evidence.targetKnowledgeComponentId === 'string' &&
        !targets.includes(evidence.targetKnowledgeComponentId)
      )
        add(
          'TASK_FAMILY_EVIDENCE_TARGET_MISMATCH',
          `${path}.canProduceEvidenceIds[${evidenceIndex}]`,
          `EvidenceSpec "${evidenceId}" targets a Knowledge Component outside this Task Family's targets.`,
        );
      const observable = isRecord(evidence.observable) ? evidence.observable : undefined;
      if (
        typeof familyResponse === 'string' &&
        typeof observable?.response === 'string' &&
        familyResponse !== observable.response
      )
        add(
          'TASK_FAMILY_EVIDENCE_RESPONSE_MISMATCH',
          `${path}.canProduceEvidenceIds[${evidenceIndex}]`,
          `EvidenceSpec "${evidenceId}" response does not match this Task Family response.`,
        );
    });

    const variants = requireArray(row, 'variants', `${path}.variants`);
    const variantIds = new Map<string, string>();
    const variantRows = new Map<string, UnknownRecord>();
    variants.forEach((variantCandidate, variantIndex) => {
      const variantPath = `${path}.variants[${variantIndex}]`;
      const variant = requireObject(variantCandidate, variantPath);
      if (!variant) return;
      const variantId = requireString(variant, 'id', `${variantPath}.id`, { stableId: true });
      if (variantId && stableIdPattern.test(variantId)) {
        if (variantIds.has(variantId))
          add(
            'DUPLICATE_ID',
            `${variantPath}.id`,
            `ID "${variantId}" is already declared at ${variantIds.get(variantId)}.`,
          );
        else variantIds.set(variantId, `${variantPath}.id`);
        variantRows.set(variantId, variant);
      }
      const variantDimensions = requireObject(variant.dimensions, `${variantPath}.dimensions`);
      if (variantDimensions) {
        for (const [dimension, value] of Object.entries(variantDimensions)) {
          if (!dimensionKeys.has(dimension))
            add(
              'UNDECLARED_TASK_DIMENSION',
              `${variantPath}.dimensions.${dimension}`,
              `Task dimension "${dimension}" is not declared by its Task Family.`,
            );
          if (!isJsonPrimitive(value))
            add(
              'INVALID_TASK_DIMENSION_VALUE',
              `${variantPath}.dimensions.${dimension}`,
              'Task dimension values must be string, finite number, boolean, or null.',
            );
        }
      }
    });
    if (familyId && stableIdPattern.test(familyId))
      familyRows.set(familyId, { row, path, variants: variantRows });

    const sequences = requireArray(
      row,
      'linkedContrastSequences',
      `${path}.linkedContrastSequences`,
    );
    const sequenceIds = new Map<string, string>();
    sequences.forEach((sequenceCandidate, sequenceIndex) => {
      const sequencePath = `${path}.linkedContrastSequences[${sequenceIndex}]`;
      const sequence = requireObject(sequenceCandidate, sequencePath);
      if (!sequence) return;
      const sequenceId = requireString(sequence, 'id', `${sequencePath}.id`, { stableId: true });
      if (sequenceId && stableIdPattern.test(sequenceId)) {
        if (sequenceIds.has(sequenceId))
          add(
            'DUPLICATE_ID',
            `${sequencePath}.id`,
            `ID "${sequenceId}" is already declared at ${sequenceIds.get(sequenceId)}.`,
          );
        else sequenceIds.set(sequenceId, `${sequencePath}.id`);
      }
      const invariants = requireStringArray(
        sequence,
        'invariantDimensions',
        `${sequencePath}.invariantDimensions`,
      );
      invariants.forEach((dimension, dimensionIndex) => {
        if (!dimensionKeys.has(dimension))
          add(
            'UNDECLARED_TASK_DIMENSION',
            `${sequencePath}.invariantDimensions[${dimensionIndex}]`,
            `Task dimension "${dimension}" is not declared by its Task Family.`,
          );
      });
      const steps = requireArray(sequence, 'steps', `${sequencePath}.steps`);
      if (steps.length < 2)
        add(
          'LINKED_CONTRAST_TOO_SHORT',
          `${sequencePath}.steps`,
          'A linked contrast sequence must contain at least two steps.',
        );
      const changedByStep: string[][] = [];
      const variantByStep: (UnknownRecord | undefined)[] = [];
      steps.forEach((stepCandidate, stepIndex) => {
        const stepPath = `${sequencePath}.steps[${stepIndex}]`;
        const step = requireObject(stepCandidate, stepPath);
        if (!step) {
          changedByStep.push([]);
          variantByStep.push(undefined);
          return;
        }
        const variantId = requireString(step, 'variantId', `${stepPath}.variantId`, {
          stableId: true,
        });
        const variant = variantId ? variantRows.get(variantId) : undefined;
        if (variantId && stableIdPattern.test(variantId) && !variant)
          add(
            'UNKNOWN_TASK_VARIANT',
            `${stepPath}.variantId`,
            `Unknown TaskVariant "${variantId}" in this Task Family.`,
          );
        const changed = requireStringArray(
          step,
          'changedDimensions',
          `${stepPath}.changedDimensions`,
        );
        changed.forEach((dimension, dimensionIndex) => {
          if (!dimensionKeys.has(dimension))
            add(
              'UNDECLARED_TASK_DIMENSION',
              `${stepPath}.changedDimensions[${dimensionIndex}]`,
              `Task dimension "${dimension}" is not declared by its Task Family.`,
            );
          if (invariants.includes(dimension))
            add(
              'LINKED_CONTRAST_DIMENSION_CONFLICT',
              `${stepPath}.changedDimensions[${dimensionIndex}]`,
              `Dimension "${dimension}" cannot be both invariant and changed.`,
            );
        });
        changedByStep.push(changed);
        variantByStep.push(variant);
      });
      if (steps.length > 0 && changedByStep[0]?.length > 0)
        add(
          'LINKED_CONTRAST_FIRST_STEP_CHANGED_DIMENSIONS',
          `${sequencePath}.steps[0].changedDimensions`,
          'The first linked contrast step has no preceding variant and must declare no changed dimensions.',
        );
      for (let index = 1; index < steps.length; index += 1) {
        const before = variantByStep[index - 1]?.dimensions;
        const after = variantByStep[index]?.dimensions;
        if (!isRecord(before) || !isRecord(after)) continue;
        const allDimensions = new Set([...Object.keys(before), ...Object.keys(after)]);
        const actualChanged = [...allDimensions].filter(
          (dimension) =>
            !Object.hasOwn(before, dimension) ||
            !Object.hasOwn(after, dimension) ||
            !deepEqualJson(before[dimension], after[dimension]),
        );
        const declaredChanged = new Set(changedByStep[index]);
        const changedSet = new Set(actualChanged);
        const declaredPath = `${sequencePath}.steps[${index}].changedDimensions`;
        if (
          declaredChanged.size !== changedByStep[index].length ||
          declaredChanged.size !== changedSet.size ||
          [...changedSet].some((dimension) => !declaredChanged.has(dimension))
        )
          add(
            'LINKED_CONTRAST_CHANGED_DIMENSIONS_MISMATCH',
            declaredPath,
            `changedDimensions must exactly match the actual adjacent variant differences (${actualChanged.join(', ') || 'none'}).`,
          );
        actualChanged.forEach((dimension) => {
          if (!dimensionKeys.has(dimension))
            add(
              'UNDECLARED_TASK_DIMENSION',
              `${sequencePath}.steps[${index}].variantId`,
              `Undeclared dimension "${dimension}" changes between linked variants.`,
            );
        });
      }
      for (const [invariantIndex, dimension] of invariants.entries()) {
        const first = variantByStep.find((variant) => variant !== undefined);
        if (!first || !isRecord(first.dimensions)) continue;
        const firstDimensions = first.dimensions;
        const firstHas = Object.hasOwn(firstDimensions, dimension);
        const firstValue = firstDimensions[dimension];
        const changed = variantByStep.some((variant) => {
          if (!variant || !isRecord(variant.dimensions)) return false;
          return (
            Object.hasOwn(variant.dimensions, dimension) !== firstHas ||
            !deepEqualJson(variant.dimensions[dimension], firstValue)
          );
        });
        if (changed)
          add(
            'LINKED_CONTRAST_INVARIANT_CHANGED',
            `${sequencePath}.invariantDimensions[${invariantIndex}]`,
            `Invariant dimension "${dimension}" changes across the linked contrast sequence.`,
          );
      }
    });
  });

  const evaluatorById = new Map<string, string>();
  evaluatorSpecs.forEach((candidate) => {
    if (
      isRecord(candidate) &&
      typeof candidate.id === 'string' &&
      typeof candidate.kind === 'string'
    )
      evaluatorById.set(candidate.id, candidate.kind);
  });
  activities.forEach((candidate, index) => {
    const path = `activities[${index}]`;
    const activity = requireObject(candidate, path);
    if (!activity) return;
    const familyId = typeof activity.taskFamilyId === 'string' ? activity.taskFamilyId : undefined;
    let family: UnknownRecord | undefined;
    if (activity.taskFamilyId !== undefined) {
      const requestedFamilyId = requireString(activity, 'taskFamilyId', `${path}.taskFamilyId`, {
        stableId: true,
      });
      if (requestedFamilyId && stableIdPattern.test(requestedFamilyId)) {
        family = familyRows.get(requestedFamilyId)?.row;
        if (!family)
          add(
            'UNKNOWN_TASK_FAMILY',
            `${path}.taskFamilyId`,
            `Unknown Task Family "${requestedFamilyId}".`,
          );
      }
    }
    const response =
      activity.response === undefined
        ? undefined
        : requireObject(activity.response, `${path}.response`);
    const responseKind = response
      ? requireEnum(response, 'kind', `${path}.response.kind`, responseKinds)
      : undefined;
    const familyResponse = isRecord(family?.response) ? family.response.kind : undefined;
    if (responseKind && typeof familyResponse === 'string' && responseKind !== familyResponse)
      add(
        'ACTIVITY_RESPONSE_KIND_MISMATCH',
        `${path}.response.kind`,
        'Activity response kind must match its Task Family response kind.',
      );
    if (activity.taskVariantId !== undefined) {
      const variantId = requireString(activity, 'taskVariantId', `${path}.taskVariantId`, {
        stableId: true,
      });
      if (!familyId)
        add(
          'TASK_VARIANT_WITHOUT_FAMILY',
          `${path}.taskVariantId`,
          'taskVariantId requires taskFamilyId.',
        );
      else if (variantId && stableIdPattern.test(variantId)) {
        const familyInfo = familyRows.get(familyId);
        if (familyInfo && !familyInfo.variants.has(variantId)) {
          const knownInAnotherFamily = [...familyRows.entries()].some(
            ([knownFamilyId, info]) => knownFamilyId !== familyId && info.variants.has(variantId),
          );
          const code = knownInAnotherFamily
            ? 'TASK_VARIANT_FAMILY_MISMATCH'
            : 'UNKNOWN_TASK_VARIANT';
          const reason = knownInAnotherFamily
            ? `is not declared by Task Family "${familyId}"`
            : 'is unknown';
          add(code, `${path}.taskVariantId`, `TaskVariant "${variantId}" ${reason}.`);
        }
      }
    }
    const evidenceIds = requireStringArray(activity, 'evidenceSpecIds', `${path}.evidenceSpecIds`);
    if (evidenceIds.length > 0 && responseKind === undefined)
      add(
        'ACTIVITY_EVIDENCE_WITHOUT_RESPONSE',
        `${path}.evidenceSpecIds`,
        'An Activity that produces Evidence must define a learner response.',
      );
    const producibleEvidenceIds = Array.isArray(family?.canProduceEvidenceIds)
      ? family.canProduceEvidenceIds
      : [];
    evidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidencePath = `${path}.evidenceSpecIds[${evidenceIndex}]`;
      if (!ids.evidenceSpecs.has(evidenceId))
        add('UNKNOWN_EVIDENCE_SPEC', evidencePath, `Unknown EvidenceSpec "${evidenceId}".`);
      const evidence = evidenceById.get(evidenceId);
      if (family && !producibleEvidenceIds.includes(evidenceId))
        add(
          'ACTIVITY_EVIDENCE_NOT_PRODUCIBLE_BY_TASK_FAMILY',
          evidencePath,
          `Task Family "${familyId}" cannot produce EvidenceSpec "${evidenceId}".`,
        );
      const observable = isRecord(evidence?.observable) ? evidence.observable : undefined;
      if (
        responseKind &&
        typeof observable?.response === 'string' &&
        responseKind !== observable.response
      )
        add(
          'ACTIVITY_EVIDENCE_RESPONSE_MISMATCH',
          evidencePath,
          `Activity response kind does not match EvidenceSpec "${evidenceId}" response.`,
        );
      const requires = isRecord(evidence?.requires) ? evidence.requires : undefined;
      if (requires?.freshBeforeAnswerExposure === true) {
        const gate = isRecord(activity.feedbackGate) ? activity.feedbackGate : undefined;
        if (gate?.revealMode !== 'after-commit')
          add(
            'FRESH_EVIDENCE_REVEALED_IMMEDIATELY',
            `${path}.feedbackGate.revealMode`,
            'Fresh independent Evidence requires feedbackGate.revealMode to be after-commit.',
          );
      }
      const evaluatorId = typeof family?.evaluatorId === 'string' ? family.evaluatorId : undefined;
      if (
        responseKind === 'explanation' &&
        observable?.correctness === 'semantic' &&
        evaluatorId !== undefined &&
        evaluatorById.get(evaluatorId) === 'not-scored'
      )
        add(
          'UNSCORED_EXPLANATION_SEMANTIC_EVIDENCE',
          `${path}.response.kind`,
          'An ungraded evaluator cannot claim semantic correctness for an explanation response.',
        );
    });
    for (const contentField of ['content', 'revealContent']) {
      const content = requireArray(activity, contentField, `${path}.${contentField}`);
      content.forEach((contentCandidate, contentIndex) => {
        const contentPath = `${path}.${contentField}[${contentIndex}]`;
        const item = requireObject(contentCandidate, contentPath);
        if (!item) return;
        const kind = requireEnum(item, 'kind', `${contentPath}.kind`, contentKinds);
        if (kind === 'text') requireString(item, 'text', `${contentPath}.text`);
        else if (kind === 'code') {
          requireEnum(item, 'language', `${contentPath}.language`, ['html', 'css', 'text']);
          requireString(item, 'code', `${contentPath}.code`);
        } else if (kind === 'resource') {
          const resourceId = requireString(item, 'resourceId', `${contentPath}.resourceId`, {
            stableId: true,
          });
          if (resourceId && stableIdPattern.test(resourceId) && !ids.resources.has(resourceId))
            add(
              'UNKNOWN_RESOURCE',
              `${contentPath}.resourceId`,
              `Unknown Resource "${resourceId}".`,
            );
        }
      });
    }
    const feedbackGate = requireObject(activity.feedbackGate, `${path}.feedbackGate`);
    if (feedbackGate)
      requireEnum(feedbackGate, 'revealMode', `${path}.feedbackGate.revealMode`, [
        'immediate',
        'after-commit',
      ]);
  });

  corePlan.forEach((candidate, index) => {
    const path = `corePlan[${index}]`;
    const step = requireObject(candidate, path);
    if (!step) return;
    const activityId = requireString(step, 'activityId', `${path}.activityId`, { stableId: true });
    if (activityId && stableIdPattern.test(activityId) && !ids.activities.has(activityId))
      add('UNKNOWN_ACTIVITY', `${path}.activityId`, `Unknown Activity "${activityId}".`);
    requireBoolean(step, 'blocking', `${path}.blocking`);
  });

  resources.forEach((candidate, index) => {
    const path = `resources[${index}]`;
    const resource = requireObject(candidate, path);
    if (!resource) return;
    requireEnum(resource, 'kind', `${path}.kind`, ['rendered-html-css', 'static-text']);
    if (!Object.hasOwn(resource, 'payload'))
      add('REQUIRED_FIELD', `${path}.payload`, `${path}.payload is required.`);
  });

  for (const [index, candidate] of knowledgeComponents.entries()) {
    const response =
      isRecord(candidate) && isRecord(candidate.response) ? candidate.response : undefined;
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      response?.variability !== 'variable'
    )
      continue;
    const targetEvidence = evidenceSpecs.filter(
      (evidence): evidence is UnknownRecord =>
        isRecord(evidence) &&
        evidence.targetKnowledgeComponentId === candidate.id &&
        isRecord(evidence.observable),
    );
    if (targetEvidence.length === 0) continue;
    const hasConstructedOrPerformanceResponse = targetEvidence.some((evidence) =>
      ['generated-code', 'execution', 'explanation', 'diagnosis'].includes(
        String((evidence.observable as UnknownRecord).response),
      ),
    );
    if (!hasConstructedOrPerformanceResponse)
      add(
        'VARIABLE_RESPONSE_RECOGNITION_ONLY_EVIDENCE',
        `knowledgeComponents[${index}]`,
        `Variable-response Knowledge Component "${candidate.id}" has only recognition-level Evidence.`,
      );
  }

  return issues.sort(
    (left, right) =>
      compareCodePointStrings(left.path, right.path) ||
      compareCodePointStrings(left.code, right.code) ||
      compareCodePointStrings(left.message, right.message),
  );
};

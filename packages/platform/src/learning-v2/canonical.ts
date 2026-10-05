import { createHash } from 'node:crypto';

const compareCodePointStrings = (left: string, right: string): number => {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
};

const sortRecursively = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (value !== null && typeof value === 'object') {
    const sorted = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort(compareCodePointStrings)) {
      sorted[key] = sortRecursively((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

export const serializeCanonicalJson = (value: unknown): string =>
  JSON.stringify(sortRecursively(value));

export const createBundleId = (canonicalJson: string): string =>
  `sha256:${createHash('sha256').update(canonicalJson, 'utf8').digest('hex')}`;

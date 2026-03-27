export const SUPPORTED_ADMONITION_TYPES = [
  'tip',
  'note',
  'warning',
  'caution',
  'important',
] as const;

export type AdmonitionType = (typeof SUPPORTED_ADMONITION_TYPES)[number];

type NextraCalloutType = 'default' | 'info' | 'warning' | 'error' | 'important';

const SUPPORTED_ADMONITION_TYPE_SET = new Set<string>(SUPPORTED_ADMONITION_TYPES);

const ADMONITION_SUGGESTIONS: Partial<Record<string, AdmonitionType>> = {
  danger: 'caution',
  default: 'tip',
  error: 'caution',
  info: 'note',
};

export const CALLOUT_TYPE_BY_ADMONITION_TYPE = {
  tip: 'default',
  note: 'info',
  warning: 'warning',
  caution: 'error',
  important: 'important',
} as const satisfies Record<AdmonitionType, NextraCalloutType>;

export const resolveAdmonitionType = (value: string): AdmonitionType | null => {
  if (!SUPPORTED_ADMONITION_TYPE_SET.has(value)) return null;
  return value as AdmonitionType;
};

export const buildUnsupportedAdmonitionMessage = (value: string) => {
  const suggestion = ADMONITION_SUGGESTIONS[value];
  const suggestionText = suggestion ? ` Did you mean "${suggestion}"?` : '';
  return `Unsupported admonition type "${value}". Supported types: ${SUPPORTED_ADMONITION_TYPES.join(', ')}.${suggestionText}`;
};

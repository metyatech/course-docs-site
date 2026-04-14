import type { Node } from 'unist';

type Parent = Node & { children: Node[] };

type MetadataNode = Node & {
  type: 'yaml' | 'toml' | 'mdxjsEsm';
  value?: string;
};

export type PageAuthoringMode = 'tutorial' | 'non-tutorial';

type ExplicitModeSource = 'yaml-frontmatter' | 'toml-frontmatter' | 'mdx-export';
type ImplicitModeSource = 'legacy-section-inference' | 'default-non-tutorial';

export type PageAuthoringModeResolution =
  | {
      mode: PageAuthoringMode;
      explicit: boolean;
      source: ExplicitModeSource | ImplicitModeSource;
      hasTutorialSection: boolean;
    }
  | {
      mode: null;
      explicit: true;
      source: ExplicitModeSource;
      hasTutorialSection: boolean;
      rawValue: string;
    };

type ExplicitModeResolution =
  | {
      mode: PageAuthoringMode;
      explicit: true;
      source: ExplicitModeSource;
    }
  | {
      mode: null;
      explicit: true;
      source: ExplicitModeSource;
      rawValue: string;
    };

const hasChildren = (node: Node): node is Parent => Array.isArray((node as Parent).children);

const normalizeModeValue = (value: string) =>
  value
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`]$/, '')
    .trim()
    .toLowerCase();

const toPageAuthoringMode = (value: string): PageAuthoringMode | null => {
  const normalized = normalizeModeValue(value);
  if (normalized === 'tutorial') return 'tutorial';
  if (normalized === 'non-tutorial') return 'non-tutorial';
  return null;
};

const extractYamlLikeScalar = (source: string, separator: ':' | '='): string | null => {
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const pattern =
      separator === ':'
        ? /^authoringMode\s*:\s*(.+?)\s*(?:#.*)?$/u
        : /^authoringMode\s*=\s*(.+?)\s*(?:#.*)?$/u;
    const match = pattern.exec(line);
    if (match) return match[1];
  }
  return null;
};

const extractMdxExportMode = (source: string): string | null => {
  const directExportMatch = /export\s+const\s+authoringMode\s*=\s*(['"`])([^'"`]+)\1/u.exec(source);
  if (directExportMatch) return directExportMatch[2];

  const metadataExportMatch =
    /export\s+const\s+metadata\s*=\s*\{[\s\S]*?\bauthoringMode\s*:\s*(['"`])([^'"`]+)\1[\s\S]*?\}/u.exec(
      source,
    );
  if (metadataExportMatch) return metadataExportMatch[2];

  return null;
};

const resolveExplicitMode = (child: MetadataNode): ExplicitModeResolution | null => {
  const value = child.value ?? '';
  let rawValue: string | null = null;

  if (child.type === 'yaml') {
    rawValue = extractYamlLikeScalar(value, ':');
    if (rawValue == null) return null;
    const mode = toPageAuthoringMode(rawValue);
    return mode
      ? { mode, explicit: true, source: 'yaml-frontmatter' }
      : { mode: null, explicit: true, source: 'yaml-frontmatter', rawValue };
  }

  if (child.type === 'toml') {
    rawValue = extractYamlLikeScalar(value, '=');
    if (rawValue == null) return null;
    const mode = toPageAuthoringMode(rawValue);
    return mode
      ? { mode, explicit: true, source: 'toml-frontmatter' }
      : { mode: null, explicit: true, source: 'toml-frontmatter', rawValue };
  }

  rawValue = extractMdxExportMode(value);
  if (rawValue == null) return null;
  const mode = toPageAuthoringMode(rawValue);
  return mode
    ? { mode, explicit: true, source: 'mdx-export' }
    : { mode: null, explicit: true, source: 'mdx-export', rawValue };
};

export const hasTutorialSection = (tree: Node): boolean => {
  let found = false;
  const walk = (node: Node) => {
    if (found) return;
    if (
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      (node as Node & { name?: string | null }).name === 'Section'
    ) {
      found = true;
      return;
    }
    if (hasChildren(node)) {
      for (const child of node.children) walk(child);
    }
  };
  walk(tree);
  return found;
};

export const resolvePageAuthoringMode = (tree: Node): PageAuthoringModeResolution => {
  const hasSection = hasTutorialSection(tree);

  if (hasChildren(tree)) {
    for (const child of tree.children) {
      if (child.type !== 'yaml' && child.type !== 'toml' && child.type !== 'mdxjsEsm') continue;
      const explicit = resolveExplicitMode(child as MetadataNode);
      if (explicit) return { ...explicit, hasTutorialSection: hasSection };
    }
  }

  if (hasSection) {
    return {
      mode: 'tutorial',
      explicit: false,
      source: 'legacy-section-inference',
      hasTutorialSection: true,
    };
  }

  return {
    mode: 'non-tutorial',
    explicit: false,
    source: 'default-non-tutorial',
    hasTutorialSection: false,
  };
};

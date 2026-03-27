import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const CONTENT_ROOT = path.join(process.cwd(), 'content');
const RESERVED_META_KEYS = new Set(['*', 'index']);

type MetaRecord = Record<string, unknown>;

const readMetaRecord = (dirPath: string): MetaRecord => {
  const metaPath = path.join(dirPath, '_meta.ts');
  if (!fs.existsSync(metaPath)) {
    return {};
  }

  const source = fs.readFileSync(metaPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const compiledModule = { exports: {} as Record<string, unknown> };
  const evaluator = new Function('module', 'exports', compiled);
  evaluator(compiledModule, compiledModule.exports);

  const exported = compiledModule.exports.default ?? compiledModule.exports;
  return exported && typeof exported === 'object' ? (exported as MetaRecord) : {};
};

const isVisibleMetaEntry = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return true;
  }

  if (!('display' in value)) {
    return true;
  }

  return value.display !== 'hidden';
};

const hasIndexPage = (dirPath: string) =>
  fs.existsSync(path.join(dirPath, 'index.mdx')) || fs.existsSync(path.join(dirPath, 'index.md'));

const resolveFirstContentPath = (dirPath: string, routePrefix: string): string | null => {
  const meta = readMetaRecord(dirPath);

  for (const [key, value] of Object.entries(meta)) {
    if (RESERVED_META_KEYS.has(key) || !isVisibleMetaEntry(value)) {
      continue;
    }

    const childDir = path.join(dirPath, key);
    if (!fs.existsSync(childDir) || !fs.statSync(childDir).isDirectory()) {
      continue;
    }

    const nextRoute = `${routePrefix}/${key}`;
    if (hasIndexPage(childDir)) {
      return nextRoute;
    }

    const nestedRoute = resolveFirstContentPath(childDir, nextRoute);
    if (nestedRoute) {
      return nestedRoute;
    }
  }

  return null;
};

export const getDefaultContentPath = () => {
  const route = resolveFirstContentPath(CONTENT_ROOT, '');
  if (!route) {
    throw new Error('Could not determine a default content route from content/_meta.ts.');
  }
  return route;
};

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const RESERVED_META_KEYS = new Set(["*", "index"]);

const readMetaRecord = (dirPath) => {
  const metaPath = path.join(dirPath, "_meta.ts");
  if (!fs.existsSync(metaPath)) return {};

  const source = fs.readFileSync(metaPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const compiledModule = { exports: {} };
  const evaluator = new Function("module", "exports", compiled);
  evaluator(compiledModule, compiledModule.exports);

  const exported = compiledModule.exports.default ?? compiledModule.exports;
  return exported && typeof exported === "object" ? exported : {};
};

const isVisibleMetaEntry = (value) => {
  if (!value || typeof value !== "object" || !("display" in value)) return true;
  return value.display !== "hidden";
};

const hasIndexPage = (dirPath) =>
  fs.existsSync(path.join(dirPath, "index.mdx")) || fs.existsSync(path.join(dirPath, "index.md"));

const resolveFirstContentPath = (dirPath, routePrefix) => {
  const meta = readMetaRecord(dirPath);

  for (const [key, value] of Object.entries(meta)) {
    if (RESERVED_META_KEYS.has(key) || !isVisibleMetaEntry(value)) continue;

    const childDir = path.join(dirPath, key);
    if (!fs.existsSync(childDir) || !fs.statSync(childDir).isDirectory()) continue;

    const nextRoute = `${routePrefix}/${key}`;
    if (hasIndexPage(childDir)) return nextRoute;

    const nestedRoute = resolveFirstContentPath(childDir, nextRoute);
    if (nestedRoute) return nestedRoute;
  }

  return null;
};

/** Resolve the first visible content route during Next configuration/build. */
export const resolveDefaultContentPath = ({
  contentRoot = path.join(process.cwd(), "content"),
} = {}) => {
  const route = resolveFirstContentPath(contentRoot, "");
  if (!route) {
    throw new Error("Could not determine a default content route from content/_meta.ts.");
  }
  return route;
};

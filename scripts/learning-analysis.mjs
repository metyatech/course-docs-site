import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { unified } from "unified";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { parse as parseYaml } from "yaml";
import {
  analyzeLearningProgression,
  collectLearningContent,
  validateLearningUnitModel,
} from "@metyatech/course-docs-platform/mdx/learning-model";

const collectMdxFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMdxFiles(target)));
    else if (entry.isFile() && /\.mdx$/iu.test(entry.name)) files.push(target);
  }
  return files.sort();
};

const readMetaOrder = async (directory) => {
  const metaPath = path.join(directory, "_meta.ts");
  try {
    const source = await readFile(metaPath, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const compiledModule = { exports: {} };
    new Function("module", "exports", compiled)(compiledModule, compiledModule.exports);
    const exported = compiledModule.exports.default ?? compiledModule.exports;
    return exported && typeof exported === "object" ? Object.entries(exported) : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(`Unable to read Nextra navigation order at ${metaPath}: ${error.message}`);
  }
};

const orderedMdxFiles = async (contentRoot) => {
  const allFiles = await collectMdxFiles(contentRoot);
  const remaining = new Set(allFiles);
  const ordered = [];
  let usedFallback = false;
  const walk = async (directory) => {
    const meta = await readMetaOrder(directory);
    const listed = new Set();
    for (const [key, value] of meta) {
      if (key === "*" || key === "index" || value?.display === "hidden") continue;
      if (key.includes("/") || key.includes("\\") || key === "." || key === "..") {
        usedFallback = true;
        continue;
      }
      listed.add(key);
      const pageCandidates = [
        path.join(directory, `${key}.mdx`),
        path.join(directory, key, "index.mdx"),
      ];
      for (const candidate of pageCandidates) {
        if (remaining.delete(candidate)) ordered.push(candidate);
      }
      const childDirectory = path.join(directory, key);
      try {
        if ((await readdir(childDirectory)).length >= 0) await walk(childDirectory);
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      }
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries
      .filter((item) => item.isDirectory())
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (!listed.has(entry.name)) await walk(path.join(directory, entry.name));
    }
  };
  await walk(contentRoot);
  for (const file of [...remaining].sort()) {
    usedFallback = true;
    ordered.push(file);
  }
  return {
    files: ordered,
    orderCertain: !usedFallback,
    orderSource: "Nextra _meta.ts; stable path fallback for unlisted pages",
  };
};

export const analyzeCourseLearning = async ({ root = process.cwd() } = {}) => {
  const modelPath = path.join(root, "learning-units.yaml");
  const contentPath = path.join(root, "content");
  let model;
  try {
    model = parseYaml(await readFile(modelPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT")
      return { configured: false, issues: [], progression: [], events: [], evidence: [] };
    throw new Error(`Unable to read learning unit model at ${modelPath}: ${error.message}`);
  }
  const issues = validateLearningUnitModel(model);
  if (issues.some((issue) => issue.severity === "error"))
    return {
      configured: true,
      pageOrder: { source: "unavailable (invalid learning unit model)", certain: false },
      issues,
      progression: [],
      events: [],
      evidence: [],
    };
  const pageOrder = await orderedMdxFiles(contentPath);
  const files = pageOrder.files;
  const events = [];
  const evidence = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const tree = unified().use(remarkParse).use(remarkMdx).parse(source);
    const relativePage = path.relative(contentPath, file).split(path.sep).join("/");
    const collected = collectLearningContent(tree, relativePage);
    events.push(
      ...collected.events.map((event) => ({ ...event, order: events.length + event.order })),
    );
    evidence.push(...collected.evidence);
    issues.push(...collected.issues);
  }
  const progression = analyzeLearningProgression({ units: model.units, events, evidence });
  return {
    configured: true,
    pageOrder: { source: pageOrder.orderSource, certain: pageOrder.orderCertain },
    issues: [...issues, ...progression.issues],
    progression: progression.progression,
    events: progression.events,
    evidence,
  };
};

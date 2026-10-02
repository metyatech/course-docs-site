// Shared course content quality gate for course-docs-site.
//
// Runs against the synced root `content/` directory (produced by
// `npm run sync:content`). All checks mirror the contract that used to live
// only in `javascript-course-docs/scripts/`, but they operate on any course
// content source because `content/` is a normalized mirror regardless of the
// upstream repo.
//
// This verifier enforces the **learner-facing teaching-material** quality
// contract: it protects the snippets and assets that learners read and copy.
// It is intentionally separate from the source/control-file formatting
// contract — Nextra `_meta.ts` control metadata is excluded from the
// asset-indentation rule and is left to each content repository's own
// Prettier / lint / typecheck gates. See `docs/content-quality-boundary.md`
// for the full boundary between teaching-material and source-code quality.
//
// Output is POSIX-style relative paths so CI logs stay consistent across
// Windows and Linux runners. The verifier never writes to the source
// content repository — it inspects only the local `content/` working copy.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { analyzeCourseLearning } from "./learning-analysis.mjs";

const contentDir = path.join(process.cwd(), "content");
const validatedFenceLanguages = new Set([
  "css",
  "html",
  "htm",
  "js",
  "javascript",
  "jsx",
  "json",
  "ts",
  "tsx",
  "typescript",
]);
const validatedAssetExtensions = new Set([".css", ".html", ".js", ".json", ".ts"]);

// Learner-facing code assets are enforced with a four-space indentation
// rule so the snippets that learners read and copy are visually consistent
// across courses. Nextra's `_meta.ts` files are control metadata that
// configure sidebar / page labels and ordering at the site runtime level;
// they are not learner-facing code, so the source repository's Prettier /
// lint / typecheck gates are the authoritative formatter for them. The
// verifier inspects the synced
// `content/` mirror only, so it must not re-enforce the learner-code rule
// on `_meta.ts` — doing so would force the source repo to either fork
// Prettier or carry a `_meta.ts`-specific override, both of which would
// leak site-runtime policy into a content repository.
const isNextraControlMetadata = (filePath) => {
  const base = path.basename(filePath);
  if (base !== "_meta.ts") return false;
  const relative = path.relative(process.cwd(), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return relative.split(path.sep).join("/").startsWith("content/");
};

// Tutorial-shot manifests drive the site-side screenshot annotation editor.
// They are runtime metadata, not snippets learners read or copy, and the
// editor deliberately persists compact two-space JSON. The tutorial-shot
// contract and validation live with the screenshot tooling, so the
// learner-facing asset indentation gate must leave these manifests alone.
const isTutorialShotManifest = (filePath) => {
  if (!path.basename(filePath).endsWith(".shot.json")) return false;
  const relative = path.relative(process.cwd(), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return relative.split(path.sep).join("/").startsWith("content/");
};

const repoPosixPath = (absolutePath) => {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative.split(path.sep).join("/");
};

const collectFiles = async (directory, predicate) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await collectFiles(entryPath, predicate)));
    } else if (entry.isFile() && predicate(entryPath)) {
      matches.push(entryPath);
    }
  }
  matches.sort((a, b) => (repoPosixPath(a) < repoPosixPath(b) ? -1 : 1));
  return matches;
};

// --------------------------------------------------------------------------
// Exercise structure / title-prop rules
// --------------------------------------------------------------------------

const isInFencedBlockAt = (lines, lineIndex) => {
  let inFence = false;
  for (let i = 0; i <= lineIndex; i += 1) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
    }
  }
  return inFence;
};

const findExerciseOpeningEnd = (text, startIndex) => {
  let inQuote = null;
  let braceDepth = 0;
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    if (inQuote) {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inQuote = char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "<" && braceDepth === 0) return -1;
    if (char === ">" && braceDepth === 0) {
      return i;
    }
  }
  return -1;
};

const maskQuotedAndBraced = (text) => {
  let masked = "";
  let inQuote = null;
  let braceDepth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuote) {
      if (char === "\\") {
        i += 1;
        masked += "  ";
        continue;
      }
      if (char === inQuote) {
        inQuote = null;
      }
      masked += " ";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inQuote = char;
      masked += " ";
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      masked += char;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      masked += char;
      continue;
    }
    masked += braceDepth > 0 ? " " : char;
  }
  return masked;
};

const verifyExerciseStructure = async (mdxFiles) => {
  const errors = [];
  let exerciseCount = 0;
  for (const filePath of mdxFiles) {
    const text = await readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const lineStartOffsets = [];
    let offset = 0;
    for (const line of lines) {
      lineStartOffsets.push(offset);
      offset += line.length;
      if (text[offset] === "\r") offset += 1;
      if (text[offset] === "\n") offset += 1;
    }

    for (let i = 0; i < lines.length; i += 1) {
      if (isInFencedBlockAt(lines, i)) continue;
      const line = lines[i];
      const matches = line.matchAll(/<Exercise(?=[\s/>]|$)/g);
      for (const match of matches) {
        exerciseCount += 1;
        const startIndex = lineStartOffsets[i] + match.index;
        const openEnd = findExerciseOpeningEnd(text, startIndex + match[0].length);
        if (openEnd === -1) {
          errors.push(`${repoPosixPath(filePath)}:${i + 1}: Unterminated <Exercise> opening tag.`);
          continue;
        }
        const openingTag = text.slice(startIndex, openEnd + 1);
        const maskedOpeningTag = maskQuotedAndBraced(openingTag);
        if (/\stitle\s*=/.test(maskedOpeningTag)) {
          errors.push(
            `${repoPosixPath(filePath)}:${i + 1}: <Exercise> opening tag must not use a title prop.`,
          );
        }
      }
    }
  }
  return { errors, exerciseCount };
};

// --------------------------------------------------------------------------
// Code-block / asset indentation rules
// --------------------------------------------------------------------------

/** @typedef {"highlight-next-line" | "highlight-start" | "highlight-end"} LegacyHighlightDirective */

/**
 * @typedef {Object} LegacyHighlightFinding
 * @property {string} filePath
 * @property {number} lineNumber
 * @property {LegacyHighlightDirective} directive
 */

/**
 * @typedef {Object} CodeBlockVerificationResult
 * @property {string[]} indentationErrors
 * @property {string[]} legacyHighlightErrors
 */

/**
 * Return a Docusaurus highlight directive only when the whole line is one of
 * the supported magic-comment forms.
 * @param {string} line
 * @returns {LegacyHighlightDirective | null}
 */
const parseLegacyDocusaurusHighlightDirective = (line) => {
  const directive = "(highlight-next-line|highlight-start|highlight-end)";
  const patterns = [
    new RegExp(`^\\s*//\\s*${directive}\\s*$`),
    new RegExp(`^\\s*#\\s*${directive}\\s*$`),
    new RegExp(`^\\s*/\\*\\s*${directive}\\s*\\*/\\s*$`),
    new RegExp(`^\\s*\\{\\s*/\\*\\s*${directive}\\s*\\*/\\s*\\}\\s*$`),
    new RegExp(`^\\s*<!--\\s*${directive}\\s*-->\\s*$`),
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) return /** @type {LegacyHighlightDirective} */ (match[1]);
  }
  return null;
};

const stripFencePrefix = (line, prefix) =>
  prefix !== "" && line.startsWith(prefix) ? line.slice(prefix.length) : line;

const verifyIndentation = (lines, filePath, startLineNumber, errors) => {
  let inBlockComment = false;
  for (let offset = 0; offset < lines.length; offset += 1) {
    const line = lines[offset];
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.includes("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    if (/^\t+/.test(line)) {
      errors.push(
        `${repoPosixPath(filePath)}:${startLineNumber + offset}: use spaces, not tabs, for code indentation.`,
      );
      continue;
    }
    const leadingSpaces = line.match(/^ */)[0].length;
    if (leadingSpaces % 4 !== 0) {
      errors.push(
        `${repoPosixPath(filePath)}:${startLineNumber + offset}: code indentation must use four-space steps.`,
      );
    }
  }
};

const verifyMarkdownFile = async (filePath, result) => {
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const openMatch = lines[i].match(/^([ \t>]*)(`{3,}|~{3,})([^\r\n]*)$/);
    if (!openMatch) continue;
    const [, prefix, fence, info] = openMatch;
    const fenceChar = fence[0];
    const fenceLength = fence.length;
    const closePattern = new RegExp(`^[ \\t>]*\\${fenceChar}{${fenceLength},}\\s*$`);
    if (fenceLength > 3) {
      let closeIndex = i;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (closePattern.test(lines[j])) {
          closeIndex = j;
          break;
        }
      }
      i = closeIndex;
      continue;
    }
    const language = info.trim().split(/\s+/)[0].toLowerCase();
    const codeLines = [];
    let closeIndex = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (closePattern.test(lines[j])) {
        closeIndex = j;
        break;
      }
      const codeLine = stripFencePrefix(lines[j], prefix);
      codeLines.push(codeLine);
      const directive = parseLegacyDocusaurusHighlightDirective(codeLine);
      if (directive) {
        /** @type {LegacyHighlightFinding} */
        const finding = {
          filePath: repoPosixPath(filePath),
          lineNumber: j + 1,
          directive,
        };
        result.legacyHighlightErrors.push(
          `${finding.filePath}:${finding.lineNumber}: Docusaurus magic comment "${finding.directive}" is unsupported by Nextra; use code-fence line metadata such as {1,3-5}.`,
        );
      }
    }
    if (validatedFenceLanguages.has(language)) {
      verifyIndentation(codeLines, filePath, i + 2, result.indentationErrors);
    }
    i = closeIndex;
  }
};

const verifyAssetFile = async (filePath, errors) => {
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  verifyIndentation(lines, filePath, 1, errors);
};

const verifyIndentationRules = async (mdxFiles, assetFiles) => {
  /** @type {CodeBlockVerificationResult} */
  const result = { indentationErrors: [], legacyHighlightErrors: [] };
  for (const filePath of mdxFiles) await verifyMarkdownFile(filePath, result);
  for (const filePath of assetFiles) await verifyAssetFile(filePath, result.indentationErrors);
  return result;
};

// --------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------

const main = async () => {
  let contentStat;
  try {
    contentStat = await stat(contentDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      process.stdout.write("verify-content: no content directory at ./content, skipping.\n");
      process.exit(0);
      return;
    }
    throw error;
  }
  if (!contentStat.isDirectory()) {
    process.stderr.write(`verify-content: ${contentDir} exists but is not a directory.\n`);
    process.exit(1);
    return;
  }

  const mdxFiles = await collectFiles(contentDir, (p) => /\.mdx$/i.test(p));
  const assetFiles = await collectFiles(
    contentDir,
    (p) =>
      validatedAssetExtensions.has(path.extname(p).toLowerCase()) &&
      !isNextraControlMetadata(p) &&
      !isTutorialShotManifest(p),
  );

  const exerciseResult = await verifyExerciseStructure(mdxFiles);
  if (exerciseResult.errors.length > 0) {
    process.stdout.write("Exercise structure verification failed:\n");
    for (const error of exerciseResult.errors) process.stdout.write(`- ${error}\n`);
    process.exit(1);
    return;
  }

  const codeBlockResult = await verifyIndentationRules(mdxFiles, assetFiles);
  const learningResult = await analyzeCourseLearning({ root: process.cwd() });

  let exitCode = 0;
  if (codeBlockResult.indentationErrors.length > 0) {
    exitCode = 1;
    process.stdout.write("Code block indentation verification failed:\n");
    for (const error of codeBlockResult.indentationErrors) process.stdout.write(`- ${error}\n`);
  }
  if (codeBlockResult.legacyHighlightErrors.length > 0) {
    exitCode = 1;
    process.stdout.write("Legacy Docusaurus code highlighting verification failed:\n");
    for (const error of codeBlockResult.legacyHighlightErrors) process.stdout.write(`- ${error}\n`);
  }
  const learningErrors = learningResult.issues.filter((issue) => issue.severity === "error");
  if (learningErrors.length > 0) {
    exitCode = 1;
    process.stdout.write("Learning system verification failed:\n");
    for (const issue of learningErrors) process.stdout.write(`- ${issue.message}\n`);
  }
  if (exitCode === 0) {
    process.stdout.write(
      `verify-content: ok (${exerciseResult.exerciseCount} <Exercise> blocks, ${mdxFiles.length} mdx files, ${assetFiles.length} asset files${learningResult.configured ? `, ${learningResult.progression.length} learning units, ${learningResult.events.length} learning events` : ""}).\n`,
    );
  }
  process.exit(exitCode);
};

await main();

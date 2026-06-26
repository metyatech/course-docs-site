// Shared course content quality gate for course-docs-site.
//
// Runs against the synced root `content/` directory (produced by
// `npm run sync:content`). All checks mirror the contract that used to live
// only in `javascript-course-docs/scripts/`, but they operate on any course
// content source because `content/` is a normalized mirror regardless of the
// upstream repo.
//
// Output is POSIX-style relative paths so CI logs stay consistent across
// Windows and Linux runners. The verifier never writes to the source
// content repository — it inspects only the local `content/` working copy.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
const validatedAssetExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".ts",
]);

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
// Exercise heading / title-prop rules
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

const findExerciseOpeningEnd = (tagLine, startIndex) => {
  let inQuote = null;
  let braceDepth = 0;
  for (let i = startIndex; i < tagLine.length; i += 1) {
    const char = tagLine[i];
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

const verifyExerciseHeadings = async (mdxFiles) => {
  const errors = [];
  let exerciseCount = 0;
  for (const filePath of mdxFiles) {
    const text = await readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (isInFencedBlockAt(lines, i)) continue;
      const line = lines[i];
      const match = line.match(/<Exercise([\s>/]|$)/);
      if (!match) continue;
      // Skip false positives like `<ExerciseFoo>`.
      const followingChar = line[match.index + "<Exercise".length] ?? "";
      if (followingChar && !/[\s>/]/.test(followingChar)) continue;
      exerciseCount += 1;
      const openEnd = findExerciseOpeningEnd(line, match.index + "<Exercise".length);
      if (openEnd === -1) {
        errors.push(
          `${repoPosixPath(filePath)}:${i + 1}: Unterminated <Exercise> opening tag.`,
        );
        continue;
      }
      const openingTag = line.slice(match.index, openEnd + 1);
      const maskedOpeningTag = maskQuotedAndBraced(openingTag);
      if (/\stitle\s*=/.test(maskedOpeningTag)) {
        errors.push(
          `${repoPosixPath(filePath)}:${i + 1}: <Exercise> opening tag must not use a title prop.`,
        );
      }
      // Walk upward for the nearest non-blank line; allow blank lines in
      // between, but require a Markdown heading `###` through `######`.
      let cursor = i - 1;
      while (cursor >= 0 && lines[cursor].trim() === "") cursor -= 1;
      if (cursor < 0 || !/^ {0,3}#{3,6}[ \t]+\S/.test(lines[cursor])) {
        errors.push(
          `${repoPosixPath(filePath)}:${i + 1}: <Exercise> must be immediately preceded by a non-empty Markdown exercise heading (### through ######), allowing only blank lines between them.`,
        );
      }
    }
  }
  return { errors, exerciseCount };
};

// --------------------------------------------------------------------------
// Code-block / asset indentation rules
// --------------------------------------------------------------------------

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

const verifyMarkdownFile = async (filePath, errors) => {
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
      codeLines.push(stripFencePrefix(lines[j], prefix));
    }
    if (validatedFenceLanguages.has(language)) {
      verifyIndentation(codeLines, filePath, i + 2, errors);
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
  const errors = [];
  for (const filePath of mdxFiles) await verifyMarkdownFile(filePath, errors);
  for (const filePath of assetFiles) await verifyAssetFile(filePath, errors);
  return errors;
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
    (p) => validatedAssetExtensions.has(path.extname(p).toLowerCase()),
  );

  const exerciseResult = await verifyExerciseHeadings(mdxFiles);
  const indentationErrors = await verifyIndentationRules(mdxFiles, assetFiles);

  let exitCode = 0;
  if (exerciseResult.errors.length > 0) {
    exitCode = 1;
    process.stdout.write("Exercise heading verification failed:\n");
    for (const error of exerciseResult.errors) process.stdout.write(`- ${error}\n`);
  }
  if (indentationErrors.length > 0) {
    exitCode = 1;
    process.stdout.write("Code block indentation verification failed:\n");
    for (const error of indentationErrors) process.stdout.write(`- ${error}\n`);
  }
  if (exitCode === 0) {
    process.stdout.write(
      `verify-content: ok (${exerciseResult.exerciseCount} <Exercise> blocks, ${mdxFiles.length} mdx files, ${assetFiles.length} asset files).\n`,
    );
  }
  process.exit(exitCode);
};

await main();
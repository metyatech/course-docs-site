import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")),
  "..",
);
const scriptPath = path.join(projectRoot, "scripts", "verify-content.mjs");

const runVerifier = (cwd, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

const writeFixture = async (rootDir, relativePath, contents) => {
  const absolutePath = path.join(rootDir, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
  return absolutePath;
};

test("verify-content exits 0 when no content directory is present", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    const result = await runVerifier(tempDir);
    assert.equal(
      result.code,
      0,
      `expected 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /no content directory/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content passes on a clean fixture", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      [
        "---",
        "title: サンプル",
        "---",
        "",
        "### 演習1",
        "",
        "<Exercise>",
        "",
        "本文",
        "",
        "</Exercise>",
        "",
      ].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/foo/style.css",
      ["body {", "    color: red;", "}", ""].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/foo/snippet.html",
      ["<main>", "    <p>ok</p>", "</main>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.equal(
      result.code,
      0,
      `expected 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content flags <Exercise> without a preceding heading", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Exercise heading verification failed/);
    assert.match(result.stdout, /index\.mdx/);
    assert.match(result.stdout, /preceded by a non-empty Markdown exercise heading/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content flags a title prop on <Exercise>", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["### 演習1", "", '<Exercise title="bad">', "本文", "</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Exercise heading verification failed/);
    assert.match(result.stdout, /must not use a title prop/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content flags a <Exercise> opening tag inside a fenced code block", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      [
        "### 演習1",
        "",
        "```mdx",
        "<Exercise>",
        "```",
        "",
        "<Exercise>",
        "本文",
        "</Exercise>",
        "",
      ].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Exercise heading verification failed/);
    // The fenced <Exercise> must not be counted; only the real one (with no heading) should fail.
    assert.equal(
      (result.stdout.match(/preceded by a non-empty Markdown exercise heading/g) ?? []).length,
      1,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content flags 2-space fenced indentation and tab indentation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      [
        "### 演習1",
        "",
        "<Exercise>",
        "",
        "```css",
        "body {",
        "  color: red;",
        "}",
        "```",
        "",
        "</Exercise>",
        "",
      ].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/foo/tab.mdx",
      [
        "### 演習1",
        "",
        "<Exercise>",
        "",
        "```js",
        "const x = 1;",
        "```",
        "",
        "</Exercise>",
        "",
      ].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Code block indentation verification failed/);
    assert.match(result.stdout, /index\.mdx/);
    assert.match(result.stdout, /four-space steps/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content flags asset files outside the four-space rule", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/style.css",
      ["body {", "  color: red;", "}", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Code block indentation verification failed/);
    assert.match(result.stdout, /content\/docs\/foo\/style\.css/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content flags tab-indented asset files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/script.js",
      ["function f() {", "\treturn 1;", "}", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /use spaces, not tabs/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content error paths use POSIX-style relative paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    // Must not contain Windows backslashes in any reported file path.
    assert.doesNotMatch(result.stdout, /content\\docs\\foo\\index\.mdx/);
    assert.match(result.stdout, /content\/docs\/foo\/index\.mdx/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content prints paths relative to repo root, not the absolute temp dir", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, new RegExp(tempDir.replace(/\\/g, "/")));
    assert.doesNotMatch(result.stdout, /course-docs-verify-content-/);
    assert.match(result.stdout, /content\/docs\/foo\/index\.mdx/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content accepts Exercise with JSX-expr title inside braces (no real title prop)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["### 演習1", "", "<Exercise>{`title`}</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.equal(
      result.code,
      0,
      `expected 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content allows long-fence embedded examples without rewriting them", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    // 4-backtick fence containing 3-backtick fence; the outer long fence must
    // be detected and the body must NOT be indented-checked.
    const contents = [
      "### 演習1",
      "",
      "<Exercise>",
      "",
      "````mdx",
      "```css",
      "body {",
      "  color: red;",
      "}",
      "```",
      "````",
      "",
      "</Exercise>",
      "",
    ].join("\n");
    await writeFixture(tempDir, "content/docs/foo/index.mdx", contents);

    const result = await runVerifier(tempDir);
    assert.equal(
      result.code,
      0,
      `expected 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content ignores MDX files outside content/ (does not scan scripts or tests)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    // Place an obviously bad MDX outside content/ — verifier must not look at it.
    await writeFixture(
      tempDir,
      "scripts/notes/index.mdx",
      ["<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/clean/index.mdx",
      ["### 演習1", "", "<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.equal(
      result.code,
      0,
      `expected 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content reports aggregate failure but still lists all issues", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/bar/index.mdx",
      ["<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /content\/docs\/foo\/index\.mdx/);
    assert.match(result.stdout, /content\/docs\/bar\/index\.mdx/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content exit code is 1 even when only one of multiple checks fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/foo/style.css",
      ["body {", "  color: red;", "}", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Exercise heading verification failed/);
    assert.match(result.stdout, /Code block indentation verification failed/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content accepts Nextra _meta.ts control metadata with 2-space indentation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    // This fixture uses 2-space indentation to prove _meta.ts is governed
    // by source/control-file gates, not by the learner-facing four-space
    // asset gate.
    await writeFixture(
      tempDir,
      "content/_meta.ts",
      [
        "const meta = {",
        "  '*': {",
        "    type: 'page',",
        "    theme: {",
        "      timestamp: false,",
        "    },",
        "  },",
        "  docs: 'Docs',",
        "};",
        "",
        "export default meta;",
        "",
      ].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/_meta.ts",
      [
        "const meta = {",
        "  intro: {},",
        "  'teacher-guide': {",
        "    display: 'hidden',",
        "  },",
        "};",
        "",
        "export default meta;",
        "",
      ].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.equal(
      result.code,
      0,
      `expected 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.doesNotMatch(result.stdout, /content\/_meta\.ts/);
    assert.doesNotMatch(result.stdout, /content\/docs\/_meta\.ts/);
    assert.match(result.stdout, /0 asset files/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content still flags ordinary .ts assets with 2-space indentation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    // An ordinary .ts asset (e.g. a learner-facing example file) must still
    // be caught — only _meta.ts is excluded from the gate.
    await writeFixture(
      tempDir,
      "content/docs/foo/example.ts",
      ["export function add(a: number, b: number) {", "  return a + b;", "}", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Code block indentation verification failed/);
    assert.match(result.stdout, /content\/docs\/foo\/example\.ts/);
    assert.match(result.stdout, /four-space steps/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content distinguishes _meta.ts from ordinary .ts assets in the same fixture", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    // 2-space _meta.ts is allowed.
    await writeFixture(
      tempDir,
      "content/_meta.ts",
      ["const meta = {", "  docs: 'Docs',", "};", "", "export default meta;", ""].join("\n"),
    );
    // 2-space ordinary .ts asset is still caught.
    await writeFixture(
      tempDir,
      "content/docs/foo/example.ts",
      ["export const greeting = () => {", "  return 'hi';", "};", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /content\/docs\/foo\/example\.ts/);
    assert.doesNotMatch(result.stdout, /content\/_meta\.ts/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content does not scan a _meta.ts placed outside content/", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    // A _meta.ts at the repo root is not a synced Nextra control file —
    // the verifier walks only content/. A file outside content/ must not
    // be touched at all. We also confirm that placing it next to a clean
    // content tree does not regress.
    await writeFixture(
      tempDir,
      "_meta.ts",
      ["const meta = {", "  docs: 'Docs',", "};", "", "export default meta;", ""].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/docs/foo/index.mdx",
      ["### 演習1", "", "<Exercise>", "本文", "</Exercise>", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.equal(
      result.code,
      0,
      `expected 0, got ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.doesNotMatch(result.stdout, /_meta\.ts/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify-content _meta.ts exclusion is path-scoped to content/ (not site root)", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "course-docs-verify-content-"));
  try {
    // A 2-space _meta.ts under content/ is allowed (Nextra control metadata),
    // and a 2-space ordinary .ts asset under content/ is still caught. This
    // confirms the exclusion is path-scoped: only content/**/_meta.ts is
    // skipped, not every _meta.ts-shaped file the verifier encounters.
    await writeFixture(
      tempDir,
      "content/section/_meta.ts",
      [
        "const meta = {",
        "  index: { display: 'hidden' },",
        "};",
        "",
        "export default meta;",
        "",
      ].join("\n"),
    );
    await writeFixture(
      tempDir,
      "content/section/example.ts",
      ["export const value = () => {", "  return 1;", "};", ""].join("\n"),
    );

    const result = await runVerifier(tempDir);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /content\/section\/example\.ts/);
    assert.doesNotMatch(result.stdout, /content\/section\/_meta\.ts/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDefaultContentPath } from "../scripts/default-content-path.mjs";

const writePage = async (contentRoot, slug) => {
  const pageDirectory = path.join(contentRoot, slug);
  await mkdir(pageDirectory, { recursive: true });
  await writeFile(path.join(pageDirectory, "index.mdx"), "", "utf8");
};

test("default content path follows static Nextra order and skips statically hidden items", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "course-docs-default-path-"));
  const contentRoot = path.join(root, "content");
  try {
    await writePage(contentRoot, "first");
    await writePage(contentRoot, "second");
    await writePage(contentRoot, "hidden");
    await writeFile(
      path.join(contentRoot, "_meta.ts"),
      [
        "const meta = {",
        '  "*": {},',
        '  hidden: { display: "hidden" },',
        "  second: {},",
        "  first: {},",
        "};",
        "export default meta;",
      ].join("\n"),
      "utf8",
    );
    assert.equal(resolveDefaultContentPath({ contentRoot }), "/second");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("default content path uses a sorted directory fallback without executing dynamic metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "course-docs-default-path-"));
  const contentRoot = path.join(root, "content");
  const marker = "__courseDocsDefaultMetaMustNotExecute";
  delete globalThis[marker];
  try {
    await writePage(contentRoot, "zeta");
    await writePage(contentRoot, "alpha");
    await writeFile(
      path.join(contentRoot, "_meta.ts"),
      `function buildMeta() { globalThis.${marker} = true; throw new Error('metadata code executed'); }\nexport default buildMeta();\n`,
      "utf8",
    );
    assert.equal(resolveDefaultContentPath({ contentRoot }), "/alpha");
    assert.equal(globalThis[marker], undefined);
  } finally {
    delete globalThis[marker];
    await rm(root, { recursive: true, force: true });
  }
});

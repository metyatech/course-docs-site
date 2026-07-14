import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

test("platform is a root npm workspace with matching package metadata", () => {
  const rootPackage = readJson("package.json");
  const platformPackage = readJson("packages/platform/package.json");

  assert.deepEqual(rootPackage.workspaces, ["packages/platform"]);
  assert.equal(rootPackage.dependencies["@metyatech/course-docs-platform"], "0.0.0");
  assert.equal(platformPackage.name, "@metyatech/course-docs-platform");
  assert.equal(platformPackage.version, "0.0.0");
  assert.deepEqual(platformPackage.repository, {
    type: "git",
    url: "git+https://github.com/metyatech/course-docs-site.git",
    directory: "packages/platform",
  });
  assert.deepEqual(platformPackage.bugs, {
    url: "https://github.com/metyatech/course-docs-site/issues",
  });
  assert.equal(
    platformPackage.homepage,
    "https://github.com/metyatech/course-docs-site/tree/main/packages/platform#readme",
  );
});

test("root ESLint excludes the workspace package and synced course content", () => {
  const eslintConfig = fs.readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
  assert.match(eslintConfig, /'packages\/platform\/\*\*\/\*'/);
  assert.match(eslintConfig, /'content\/\*\*\/\*'/);
});

test("root lockfile links the platform workspace without the old Git dependency", () => {
  const lockfile = readJson("package-lock.json");

  assert.ok(lockfile.packages["packages/platform"]);
  assert.deepEqual(lockfile.packages["node_modules/@metyatech/course-docs-platform"], {
    resolved: "packages/platform",
    link: true,
  });
  assert.equal(
    Object.values(lockfile.packages).some(
      (entry) =>
        entry?.name === "@metyatech/course-docs-platform" &&
        typeof entry.resolved === "string" &&
        /^git\+(?:https|ssh):/i.test(entry.resolved),
    ),
    false,
  );
});

test("obsolete standalone-platform files and SHA cache implementation are absent", () => {
  for (const relativePath of [
    "packages/platform/package-lock.json",
    "packages/platform/.github/workflows",
    "packages/platform/.husky",
    "packages/platform/AGENTS.md",
    `scripts/${["check", "platform", "cache"].join("-")}.mjs`,
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} must be absent`);
  }

  const rootPackage = readJson("package.json");
  assert.doesNotMatch(rootPackage.scripts.postinstall, new RegExp(["check", "platform", "cache"].join("-")));
});

test("all platform exports resolve after the workspace package is built", async () => {
  const platformPackage = readJson("packages/platform/package.json");

  for (const exportPath of Object.keys(platformPackage.exports)) {
    const resolvedPath = exportPath.replace("*", "course-base.css");
    const specifier =
      resolvedPath === "."
        ? "@metyatech/course-docs-platform"
        : `@metyatech/course-docs-platform/${resolvedPath.slice("./".length)}`;
    assert.doesNotThrow(() => require.resolve(specifier), specifier);
  }

  const mdxConsumer = fs.readFileSync(path.join(root, "src/mdx-components.tsx"), "utf8");
  const serverConsumer = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.match(mdxConsumer, /from "@metyatech\/course-docs-platform\/mdx"/);
  assert.match(serverConsumer, /from "@metyatech\/course-docs-platform\/next-app\/create-root-layout"/);
});

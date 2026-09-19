import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncScriptPath = path.join(projectRoot, "scripts", "sync-course-content.mjs");

const fileExists = async (filePath) => {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const safeRm = async (targetPath) => {
  await fs.rm(targetPath, { recursive: true, force: true });
};

const writeFile = async (rootDir, relativePath, contents) => {
  const filePath = path.join(rootDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
};

const writeBaseCourseRepo = async (rootDir, courseName) => {
  await writeFile(
    rootDir,
    "site.config.ts",
    `export const siteConfig = { logoText: ${JSON.stringify(courseName)} } as const;\n`,
  );
  await writeFile(rootDir, "content/_meta.ts", "export default {};\n");
  await writeFile(rootDir, "content/docs/_meta.ts", "export default {};\n");
  await writeFile(rootDir, "content/docs/intro/index.mdx", `# ${courseName}\n`);
  await writeFile(rootDir, "public/img/favicon.ico", "");
};

const snapshotFiles = async (rootDir) => {
  const entries = [];
  const visit = async (currentDir, relativeDir = "") => {
    for (const entry of await fs.readdir(currentDir, { withFileTypes: true })) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else {
        entries.push([relativePath, await fs.readFile(absolutePath, "utf8")]);
      }
    }
  };
  await visit(rootDir);
  return entries.sort(([left], [right]) => left.localeCompare(right));
};

const runSync = ({ cwd, source }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [syncScriptPath], {
      cwd,
      env: { ...process.env, COURSE_CONTENT_SOURCE: source },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

test(
  "sync excludes Open Campus authoring files, keeps runtime assets, and clears stale files",
  { timeout: 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-deployment-assets-"));
    const siteRoot = path.join(tempRoot, "site");
    const sourceRoot = path.join(tempRoot, "open-campus-source");

    await writeBaseCourseRepo(sourceRoot, "Open Campus fixture");
    await writeFile(sourceRoot, "content/docs/student-guide/shots/example.raw.png", "raw");
    await writeFile(sourceRoot, "content/docs/student-guide/shots/example.shot.json", "shot");
    await writeFile(sourceRoot, "content/docs/student-guide/img/example.png", "final image");
    await writeFile(sourceRoot, "content/docs/intro/assets/demo-complete.mp4", "video");
    await writeFile(sourceRoot, "content/docs/models/model.glb", "glb");
    await writeFile(sourceRoot, "content/docs/models/project.uasset", "uasset");
    await writeFile(sourceRoot, "content/docs/models/file.foo", "unknown");
    await writeFile(sourceRoot, "content/docs/README.md", "source");
    await writeFile(sourceRoot, "content/docs/_meta.ts", "export default {};");
    await writeFile(sourceRoot, "content/.env", "secret");
    await writeFile(sourceRoot, "content/.env.local", "secret");
    await writeFile(sourceRoot, "content/docs/private.pem", "secret");
    await writeFile(sourceRoot, "content/docs/secret.key", "secret");

    const sourceBefore = await snapshotFiles(sourceRoot);
    await writeFile(siteRoot, "content/docs/student-guide/shots/old.raw.png", "stale raw");
    await writeFile(siteRoot, "content/docs/student-guide/shots/old.shot.json", "stale shot");
    await writeFile(siteRoot, "public/_course-assets/docs/student-guide/img/stale.png", "stale");

    t.after(() => safeRm(tempRoot));

    assert.equal(await runSync({ cwd: siteRoot, source: sourceRoot }), 0);
    assert.deepEqual(await snapshotFiles(sourceRoot), sourceBefore);
    assert.equal(
      await fileExists(path.join(siteRoot, "content/docs/student-guide/shots/example.raw.png")),
      false,
    );
    assert.equal(
      await fileExists(path.join(siteRoot, "content/docs/student-guide/shots/example.shot.json")),
      false,
    );
    assert.equal(
      await fileExists(path.join(siteRoot, "content/docs/student-guide/shots/old.raw.png")),
      false,
    );
    assert.equal(
      await fileExists(path.join(siteRoot, "content/docs/student-guide/shots/old.shot.json")),
      false,
    );
    assert.equal(
      await fileExists(path.join(siteRoot, "content/docs/student-guide/img/example.png")),
      true,
    );
    assert.equal(
      await fileExists(path.join(siteRoot, "content/docs/intro/assets/demo-complete.mp4")),
      true,
    );
    assert.equal(
      await fileExists(
        path.join(siteRoot, "public/_course-assets/docs/student-guide/img/example.png"),
      ),
      true,
    );
    assert.equal(
      await fileExists(
        path.join(siteRoot, "public/_course-assets/docs/intro/assets/demo-complete.mp4"),
      ),
      true,
    );
    for (const relativePath of [
      "docs/models/model.glb",
      "docs/models/project.uasset",
      "docs/models/file.foo",
    ]) {
      assert.equal(
        await fileExists(path.join(siteRoot, "public/_course-assets", relativePath)),
        true,
        `default-static asset should be present: ${relativePath}`,
      );
    }
    assert.equal(
      await fileExists(
        path.join(siteRoot, "public/_course-assets/docs/student-guide/shots/example.raw.png"),
      ),
      false,
    );
    assert.equal(
      await fileExists(
        path.join(siteRoot, "public/_course-assets/docs/student-guide/shots/example.shot.json"),
      ),
      false,
    );
    assert.equal(
      await fileExists(
        path.join(siteRoot, "public/_course-assets/docs/student-guide/img/stale.png"),
      ),
      false,
    );
    for (const relativePath of [
      "docs/intro/index.mdx",
      "docs/README.md",
      "docs/_meta.ts",
      ".env",
      ".env.local",
      "docs/private.pem",
      "docs/secret.key",
    ]) {
      assert.equal(
        await fileExists(path.join(siteRoot, "public/_course-assets", relativePath)),
        false,
        `non-public source should be absent: ${relativePath}`,
      );
    }
  },
);

test(
  "sync excludes programming editing sources, keeps ZIP runtime assets, and clears stale directories",
  { timeout: 60_000 },
  async (t) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "course-sync-programming-assets-"));
    const siteRoot = path.join(tempRoot, "site");
    const sourceRoot = path.join(tempRoot, "programming-source");
    const excludedDirectories = [
      "docs/css-basics/css-styling-basics/assets/css-styling-basics-complete",
      "docs/html-basics/images-links/assets/images-links-complete",
      "docs/html-basics/practice-exercises/markup-exercises-advanced/assets/markup-exercises-advanced-complete",
      "docs/html-basics/text-markup/assets/text-markup-complete",
    ];

    await writeBaseCourseRepo(sourceRoot, "Programming fixture");
    for (const relativeDirectory of excludedDirectories) {
      await writeFile(sourceRoot, `content/${relativeDirectory}/editing-source.txt`, "source");
      await writeFile(sourceRoot, `content/${relativeDirectory}.zip`, "zip runtime asset");
      await writeFile(
        siteRoot,
        `content/${relativeDirectory}/stale-editing-source.txt`,
        "stale source",
      );
    }

    const sourceBefore = await snapshotFiles(sourceRoot);
    t.after(() => safeRm(tempRoot));

    assert.equal(await runSync({ cwd: siteRoot, source: sourceRoot }), 0);
    assert.deepEqual(await snapshotFiles(sourceRoot), sourceBefore);

    for (const relativeDirectory of excludedDirectories) {
      assert.equal(
        await fileExists(path.join(siteRoot, "content", ...relativeDirectory.split("/"))),
        false,
        `editing source should be absent: ${relativeDirectory}`,
      );
      assert.equal(
        await fileExists(path.join(siteRoot, "content", `${relativeDirectory}.zip`)),
        true,
        `ZIP should be present: ${relativeDirectory}.zip`,
      );
      assert.equal(
        await fileExists(
          path.join(siteRoot, "public", "_course-assets", `${relativeDirectory}.zip`),
        ),
        true,
        `ZIP should be present in generated static assets: ${relativeDirectory}.zip`,
      );
      assert.equal(
        await fileExists(path.join(siteRoot, "public", "_course-assets", relativeDirectory)),
        false,
        `editing source should be absent from generated static assets: ${relativeDirectory}`,
      );
    }
  },
);

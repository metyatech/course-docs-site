// Clears the Next.js build cache (.next) when the pinned
// course-docs-platform commit changes.  Run as part of
// postinstall so that `npm ci` followed by `npm run dev`
// never serves stale webpack modules from the old platform.

import fs from "node:fs";
import path from "node:path";
import { resolveNextDistDirPath } from "./next-dist-dir.mjs";

const projectRoot = process.cwd();
const statePath = path.join(projectRoot, ".course-content", "active-platform-sha.txt");

// ── helpers (same conventions as sync-course-content.mjs) ──

const readTextIfExists = (p) => {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
};

const writeTextFile = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const rmIfExists = (targetPath) => {
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
      return;
    }
  } catch {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
};

// ── main ──

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const platformSpec = pkg.dependencies?.["@metyatech/course-docs-platform"] ?? "";
const match = platformSpec.match(/#([0-9a-f]+)$/i);
const currentSha = match?.[1] ?? "";

if (!currentSha) {
  // Not a git-pinned dependency — nothing to track.
  process.exit(0);
}

const previousSha = readTextIfExists(statePath);

if (previousSha !== currentSha) {
  const nextDistDirPath = resolveNextDistDirPath({ projectRoot });
  if (fs.existsSync(nextDistDirPath)) {
    rmIfExists(nextDistDirPath);
    const reason = previousSha
      ? `changed from ${previousSha} to ${currentSha}`
      : `first run (no previous SHA on record)`;
    console.log(
      `Cleared ${path.relative(projectRoot, nextDistDirPath)} — ` +
        `course-docs-platform ${reason}`,
    );
  }
}

writeTextFile(statePath, currentSha);

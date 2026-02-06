import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_COURSE_CONTENT_SOURCE, parseContentSource } from './content-source.mjs';

const projectRoot = process.cwd();
const workRoot = path.join(projectRoot, '.course-content');
const cloneDir = path.join(workRoot, 'repo');
const sourceStatePath = path.join(workRoot, 'active-source.txt');

const readEnv = (filename) => {
  const envPath = path.join(projectRoot, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }
  try {
    return dotenv.parse(fs.readFileSync(envPath));
  } catch {
    return {};
  }
};

// Env precedence:
// - process.env (explicit) wins
// - later files override earlier files
const explicitEnvKeys = new Set(Object.keys(process.env));
const fileEnv = {
  ...readEnv('.env'),
  ...readEnv('.env.local'),
  ...readEnv('.env.course'),
  ...readEnv('.env.course.local'),
};
for (const [key, value] of Object.entries(fileEnv)) {
  if (!explicitEnvKeys.has(key)) {
    process.env[key] = value;
  }
}

const courseSourceText =
  process.env.COURSE_CONTENT_SOURCE?.trim() || DEFAULT_COURSE_CONTENT_SOURCE;
const courseSource = parseContentSource(courseSourceText);

const requiredPaths = [
  { label: 'content', rel: 'content' },
  { label: 'site.config.ts', rel: 'site.config.ts' },
];

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
};

const rmIfExists = (targetPath) => {
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
      return;
    }
  } catch {
    // ignore
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const readTextIfExists = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
};

const writeTextFile = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const tryLinkDir = (target, linkPath) => {
  rmIfExists(linkPath);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, 'junction');
};

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '_pagefind') {
      continue;
    }
    if (to.endsWith(`${path.sep}public`) && entry.name === 'student-works') {
      continue;
    }
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
};

const copyFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

const writeKeepFileIfRealDir = (dirPath) => {
  try {
    const st = fs.lstatSync(dirPath);
    if (st.isSymbolicLink()) {
      return;
    }
  } catch {
    // ignore
  }

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(path.join(dirPath, '.keep'), '');
};

let sourceRoot = cloneDir;
let activeSourceId = '';

if (courseSource.kind === 'local') {
  sourceRoot = path.resolve(projectRoot, courseSource.localDir);
  activeSourceId = `dir:${sourceRoot}`;
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`COURSE_CONTENT_SOURCE points to a non-directory path: ${sourceRoot}`);
  }
} else {
  fs.mkdirSync(workRoot, { recursive: true });
  rmIfExists(cloneDir);

  const repoUrl = `https://github.com/${courseSource.repo}.git`;
  run('git', ['clone', '--depth', '1', '--branch', courseSource.ref, repoUrl, cloneDir]);
  activeSourceId = `repo:${courseSource.repo}#${courseSource.ref}`;
}

if (!activeSourceId) {
  activeSourceId = sourceRoot ? `dir:${sourceRoot}` : 'unknown';
}

const previousSourceId = readTextIfExists(sourceStatePath);
if (previousSourceId && previousSourceId !== activeSourceId) {
  // Switching content can change the MDX tree and page-map.
  // Clear Next build artifacts to avoid cross-course stale runtime chunks.
  rmIfExists(path.join(projectRoot, '.next'));
}
writeTextFile(sourceStatePath, activeSourceId);

for (const required of requiredPaths) {
  const resolved = path.join(sourceRoot, required.rel);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Missing required path in content repo: ${required.label} (${required.rel})`
    );
  }
}

const contentFrom = path.join(sourceRoot, 'content');
const contentTo = path.join(projectRoot, 'content');
rmIfExists(contentTo);
if (courseSource.kind === 'local') {
  try {
    tryLinkDir(contentFrom, contentTo);
  } catch (error) {
    console.warn(
      `Warning: failed to link content directory, falling back to copy. (${error})`
    );
    copyDir(contentFrom, contentTo);
  }
} else {
  copyDir(contentFrom, contentTo);
}

if (!fs.existsSync(contentTo)) {
  fs.mkdirSync(contentTo, { recursive: true });
}
writeKeepFileIfRealDir(contentTo);

const siteConfigFrom = path.join(sourceRoot, 'site.config.ts');
const siteConfigTo = path.join(projectRoot, 'site.config.ts');
copyFile(siteConfigFrom, siteConfigTo);

const publicFrom = path.join(sourceRoot, 'public');
const publicTo = path.join(projectRoot, 'public');
if (fs.existsSync(publicFrom)) {
  rmIfExists(publicTo);
  if (courseSource.kind === 'local') {
    try {
      tryLinkDir(publicFrom, publicTo);
    } catch (error) {
      console.warn(
        `Warning: failed to link public directory, falling back to copy. (${error})`
      );
      copyDir(publicFrom, publicTo);
    }
  } else {
    copyDir(publicFrom, publicTo);
  }
  fs.mkdirSync(publicTo, { recursive: true });
  writeKeepFileIfRealDir(publicTo);
}

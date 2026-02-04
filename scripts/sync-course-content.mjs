import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const workRoot = path.join(projectRoot, '.course-content');
const cloneDir = path.join(workRoot, 'repo');

const courseRepo = process.env.COURSE_CONTENT_REPO ?? 'metyatech/javascript-course-docs';
const courseRef = process.env.COURSE_CONTENT_REF ?? 'master';

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
  fs.rmSync(targetPath, { recursive: true, force: true });
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

fs.mkdirSync(workRoot, { recursive: true });
rmIfExists(cloneDir);

const repoUrl = `https://github.com/${courseRepo}.git`;
run('git', ['clone', '--depth', '1', '--branch', courseRef, repoUrl, cloneDir]);

for (const required of requiredPaths) {
  const resolved = path.join(cloneDir, required.rel);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Missing required path in content repo: ${required.label} (${required.rel})`
    );
  }
}

const contentFrom = path.join(cloneDir, 'content');
const contentTo = path.join(projectRoot, 'content');
rmIfExists(contentTo);
copyDir(contentFrom, contentTo);
fs.mkdirSync(contentTo, { recursive: true });
fs.writeFileSync(path.join(contentTo, '.keep'), '');

const siteConfigFrom = path.join(cloneDir, 'site.config.ts');
const siteConfigTo = path.join(projectRoot, 'site.config.ts');
copyFile(siteConfigFrom, siteConfigTo);

const publicFrom = path.join(cloneDir, 'public');
const publicTo = path.join(projectRoot, 'public');
if (fs.existsSync(publicFrom)) {
  rmIfExists(publicTo);
  copyDir(publicFrom, publicTo);
  fs.mkdirSync(publicTo, { recursive: true });
  fs.writeFileSync(path.join(publicTo, '.keep'), '');
}

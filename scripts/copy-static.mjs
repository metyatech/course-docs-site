import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRootPath = fileURLToPath(new URL('..', import.meta.url));
const srcRootPath = path.join(projectRootPath, 'src');
const distRootPath = path.join(projectRootPath, 'dist');

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const walk = async (dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const run = async () => {
  const files = await walk(srcRootPath);
  const cssFiles = files.filter((filePath) => filePath.toLowerCase().endsWith('.css'));

  await Promise.all(
    cssFiles.map(async (filePath) => {
      const relativePath = path.relative(srcRootPath, filePath);
      const toPath = path.join(distRootPath, relativePath);
      await ensureDir(path.dirname(toPath));
      await fs.copyFile(filePath, toPath);
    }),
  );
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

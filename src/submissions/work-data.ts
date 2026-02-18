import fs from 'fs';
import path from 'path';
import type { StudentWorkEntry, StudentWorksData } from './types.js';

const studentWorksBasePath = path.join(process.cwd(), 'public', 'student-works');
const ignoredDirectories = new Set(['.git', 'node_modules']);

const normalizePath = (value: string) => value.split(path.sep).join('/');

const getWorksIndexUrlFromEnv = (): string | null => {
  const baseUrl = (process.env.NEXT_PUBLIC_WORKS_BASE_URL ?? '').trim();
  if (!baseUrl) {
    return null;
  }
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/works-index.json`;
};

const findIndexHtmlPath = (studentPath: string, basePath: string): string | null => {
  if (!fs.existsSync(studentPath)) {
    return null;
  }

  let currentLevel = [studentPath];

  while (currentLevel.length > 0) {
    const matches: string[] = [];
    const nextLevel: string[] = [];

    for (const dir of currentLevel) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        console.warn(`Failed to read student work directory: ${dir}`, error);
        continue;
      }

      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === 'index.html') {
          const filePath = path.join(dir, entry.name);
          const relativePath = path.relative(basePath, filePath);
          matches.push(normalizePath(relativePath));
          continue;
        }

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) {
            continue;
          }
          nextLevel.push(path.join(dir, entry.name));
        }
      }
    }

    if (matches.length > 0) {
      matches.sort((a, b) => a.localeCompare(b));
      return matches[0] ?? null;
    }

    currentLevel = nextLevel;
  }

  return null;
};

const getStudentWorksDataFromFs = (basePath = studentWorksBasePath): StudentWorksData => {
  if (!fs.existsSync(basePath)) {
    return { years: {} };
  }

  const data: Record<string, StudentWorkEntry[]> = {};

  try {
    const years = fs
      .readdirSync(basePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort();

    for (const year of years) {
      const yearPath = path.join(basePath, year);
      const studentIds = fs
        .readdirSync(yearPath, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

      data[year] = studentIds.map((studentId) => {
        const studentPath = path.join(yearPath, studentId);
        return {
          studentId,
          workPath: findIndexHtmlPath(studentPath, basePath),
        } satisfies StudentWorkEntry;
      });
    }
  } catch (error) {
    console.error('Error reading student works data:', error);
    return { years: {} };
  }

  return { years: data };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const coerceStudentWorksData = (value: unknown): StudentWorksData | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  const yearsRaw = value.years;
  if (!isPlainObject(yearsRaw)) {
    return null;
  }

  const years: Record<string, StudentWorkEntry[]> = {};
  for (const [year, entriesRaw] of Object.entries(yearsRaw)) {
    if (!Array.isArray(entriesRaw)) {
      return null;
    }
    const entries: StudentWorkEntry[] = [];
    for (const entryRaw of entriesRaw) {
      if (!isPlainObject(entryRaw)) {
        return null;
      }
      const studentId = entryRaw.studentId;
      const workPath = entryRaw.workPath;
      if (typeof studentId !== 'string') {
        return null;
      }
      if (typeof workPath !== 'string' && workPath !== null) {
        return null;
      }
      entries.push({ studentId, workPath });
    }
    years[year] = entries;
  }

  return { years };
};

const getStudentWorksDataFromRemoteIndex = async (
  indexUrl: string,
): Promise<StudentWorksData | null> => {
  try {
    const res = await fetch(indexUrl, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`Failed to fetch works index: ${indexUrl} (${res.status})`);
      return null;
    }
    const json = (await res.json()) as unknown;
    const coerced = coerceStudentWorksData(json);
    if (!coerced) {
      console.warn(`Invalid works index JSON: ${indexUrl}`);
      return null;
    }
    return coerced;
  } catch (error) {
    console.warn(`Error fetching works index: ${indexUrl}`, error);
    return null;
  }
};

export const getStudentWorksData = async (
  basePath = studentWorksBasePath,
): Promise<StudentWorksData> => {
  if (fs.existsSync(basePath)) {
    return getStudentWorksDataFromFs(basePath);
  }

  const indexUrl = getWorksIndexUrlFromEnv();
  if (!indexUrl) {
    return { years: {} };
  }

  const fromRemote = await getStudentWorksDataFromRemoteIndex(indexUrl);
  return fromRemote ?? { years: {} };
};

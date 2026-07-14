import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const workDataModuleUrl = pathToFileURL(path.resolve('dist/submissions/work-data.js')).href;

test('remote works index fetch uses ISR-friendly revalidation', async () => {
  const missingBasePath = path.join(
    os.tmpdir(),
    `course-docs-platform-missing-${Date.now()}-${Math.random()}`,
  );
  const originalBaseUrl = globalThis.process.env.NEXT_PUBLIC_WORKS_BASE_URL;
  const originalFetch = globalThis.fetch;
  let seenUrl;
  let seenOptions;

  globalThis.process.env.NEXT_PUBLIC_WORKS_BASE_URL =
    'https://metyatech.github.io/programming-course-student-works';
  globalThis.fetch = async (url, options) => {
    seenUrl = url;
    seenOptions = options;

    return {
      ok: true,
      async json() {
        return {
          years: {
            2026: [{ studentId: 'student01', workPath: '2026/student01/index.html' }],
          },
        };
      },
    };
  };

  try {
    const { getStudentWorksData } = await import(`${workDataModuleUrl}?t=${Date.now()}`);
    const result = await getStudentWorksData(missingBasePath);

    assert.equal(
      seenUrl,
      'https://metyatech.github.io/programming-course-student-works/works-index.json',
    );
    assert.deepEqual(seenOptions, {
      next: { revalidate: 300 },
    });
    assert.deepEqual(result, {
      years: {
        2026: [{ studentId: 'student01', workPath: '2026/student01/index.html' }],
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete globalThis.process.env.NEXT_PUBLIC_WORKS_BASE_URL;
    } else {
      globalThis.process.env.NEXT_PUBLIC_WORKS_BASE_URL = originalBaseUrl;
    }
  }
});

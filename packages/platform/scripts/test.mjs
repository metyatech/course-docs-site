import { spawn } from 'node:child_process';

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });

const runNpm = async (args) => {
  if (process.platform === 'win32') {
    await run('cmd.exe', ['/d', '/s', '/c', 'npm', ...args]);
    return;
  }

  await run('npm', args);
};

await runNpm(['run', 'build']);
await run(process.execPath, [
  '--test',
  'tests/admin-comment-delete-route-env.test.mjs',
  'tests/admonition-render.test.mjs',
  'tests/course-asset-config.test.mjs',
  'tests/download-link-render.test.mjs',
  'tests/exercise-contrast-styles.test.mjs',
  'tests/mdx-code-preview-boundary.test.mjs',
  'tests/mdx-guided-task-components.test.mjs',
  'tests/remark-admonitions-to-mdx.test.mjs',
  'tests/remark-inject-tutorial-shot-legend.test.mjs',
  'tests/remark-section-headings.test.mjs',
  'tests/remark-task-structure.test.mjs',
  'tests/remark-tutorial-lint.test.mjs',
  'tests/submissions-work-data.test.mjs',
  'tests/submissions-ui-regression.test.mjs',
  'tests/tutorial-action-render.test.mjs',
]);

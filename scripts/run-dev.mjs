import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

const isWindows = process.platform === 'win32';
const command = isWindows ? 'cmd.exe' : 'npm';
const npmArgs = isWindows ? ['/c', 'npm', 'run'] : ['run'];

const sync = spawn(command, [...npmArgs, 'sync:content'], { stdio: 'inherit' });
sync.on('exit', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }

  const dev = spawn(command, [...npmArgs, 'dev:inner', '--', ...args], {
    stdio: 'inherit',
  });
  dev.on('exit', (devCode) => process.exit(devCode ?? 1));
});


import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32';
const command = isWindows ? 'cmd.exe' : 'npx';
const npxArgs = isWindows ? ['/c', 'npx'] : [];

const child = spawn(command, [...npxArgs, 'next', 'dev', ...args], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));


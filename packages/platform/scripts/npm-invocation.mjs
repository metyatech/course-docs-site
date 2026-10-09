export const getNpmInvocation = (args, platform = process.platform) => {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', ...args].join(' ')],
    };
  }

  return { command: 'npm', args };
};

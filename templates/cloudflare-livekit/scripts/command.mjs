import { existsSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';

// Node cannot execute Windows .cmd/.bat launchers directly. Resolve PATH first
// so a missing CLI stays a bounded spawn failure instead of a shell diagnostic.
export function resolveCommand(command, env = process.env) {
  if (process.platform !== 'win32') return command;
  const value = (key) =>
    env[Object.keys(env).find((entry) => entry.toUpperCase() === key)] ?? '';
  const suffixes = extname(command)
    ? ['']
    : (value('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';');
  const directories = isAbsolute(command)
    ? ['']
    : value('PATH').split(delimiter);
  let executable;
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${command}${suffix}`);
      if (existsSync(candidate)) {
        executable = candidate;
        break;
      }
    }
    if (executable) break;
  }
  return executable ?? command;
}

export function commandSpec(command, arguments_, env = process.env) {
  const executable = resolveCommand(command, env);
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable)) {
    return { command: executable, arguments_ };
  }

  const escapeMeta = (text) => text.replace(/([()[\]%!^"`<>&|;, *?])/g, '^$1');
  const quoteArgument = (argument) => {
    const quoted = `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
    const escaped = escapeMeta(quoted);
    return /node_modules[\\/]\.bin[\\/]/i.test(executable)
      ? escapeMeta(escaped)
      : escaped;
  };
  const line = [escapeMeta(executable), ...arguments_.map(quoteArgument)].join(
    ' ',
  );
  return {
    command: env.ComSpec || env.COMSPEC || env.comspec || 'cmd.exe',
    arguments_: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

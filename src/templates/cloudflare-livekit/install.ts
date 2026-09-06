import { posix, win32 } from 'node:path';

import type { InstallStep } from '../../install.js';
import {
  javascriptInstallCommand,
  pythonInstallCommands,
  type CommandSpec,
  type SelectedPackageManagers,
} from '../../package-managers.js';

function commandStep(
  command: CommandSpec,
  args: string[],
  cwd: string,
  displayCommand: string,
  label: string,
): InstallStep {
  return {
    args: [...command.argsPrefix, ...args],
    command: command.command,
    cwd,
    displayCommand,
    label,
  };
}

export function createInstallPlan(
  targetDirectory: string,
  packageManagers: SelectedPackageManagers,
  platform: NodeJS.Platform = process.platform,
): InstallStep[] {
  const path = platform === 'win32' ? win32 : posix;
  const javascript = packageManagers.javascript;
  const python = packageManagers.python;
  const steps = [
    commandStep(
      javascript.command,
      ['install'],
      targetDirectory,
      javascriptInstallCommand(javascript.name),
      `Installing JavaScript dependencies with ${javascript.name}`,
    ),
  ];

  if (python.name === 'uv') {
    steps.push(
      commandStep(
        python.command,
        ['sync', '--directory', 'agent', '--extra', 'dev'],
        targetDirectory,
        pythonInstallCommands(python, platform)[0]!,
        'Installing Python dependencies with uv',
      ),
    );
    return steps;
  }

  const runtime = python.pythonRuntime;
  if (runtime === undefined) {
    throw new Error('pip was selected without a Python runtime.');
  }

  const displayedCommands = pythonInstallCommands(python, platform);
  steps.push(
    commandStep(
      runtime,
      ['-m', 'venv', 'agent/.venv'],
      targetDirectory,
      displayedCommands[0]!,
      'Creating the Python virtual environment',
    ),
  );

  const virtualEnvironmentPython =
    platform === 'win32'
      ? path.join(targetDirectory, 'agent', '.venv', 'Scripts', 'python.exe')
      : path.join(targetDirectory, 'agent', '.venv', 'bin', 'python');
  steps.push({
    args: ['-m', 'pip', 'install', '-e', '.[dev]'],
    command: virtualEnvironmentPython,
    cwd: path.join(targetDirectory, 'agent'),
    displayCommand: displayedCommands[1]!,
    label: 'Installing Python dependencies with pip',
  });

  return steps;
}

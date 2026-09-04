import { homedir } from 'node:os';
import { lstat, readdir } from 'node:fs/promises';
import { parse, resolve } from 'node:path';

import { CliError, EXIT_CODES } from './errors.js';

export type TargetState =
  'empty-directory' | 'missing' | 'not-a-directory' | 'non-empty-directory';

export function normalizeTargetDirectory(
  input: string,
  currentWorkingDirectory = process.cwd(),
): string {
  return resolve(currentWorkingDirectory, input);
}

export function assertSafeTargetDirectory(
  targetDirectory: string,
  homeDirectory = homedir(),
): void {
  const normalizedTarget = resolve(targetDirectory);

  if (normalizedTarget === parse(normalizedTarget).root) {
    throw new CliError(
      'UNSAFE_TARGET',
      'Refusing to create a project at the filesystem root.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        path: normalizedTarget,
        recovery: 'Choose a dedicated project directory.',
      },
    );
  }

  if (normalizedTarget === resolve(homeDirectory)) {
    throw new CliError(
      'UNSAFE_TARGET',
      'Refusing to create a project directly in the home directory.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        path: normalizedTarget,
        recovery:
          'Choose a dedicated project directory inside your home directory.',
      },
    );
  }
}

export async function inspectTargetDirectory(
  targetDirectory: string,
): Promise<TargetState> {
  try {
    const stats = await lstat(targetDirectory);

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return 'not-a-directory';
    }

    const entries = await readdir(targetDirectory);
    return entries.length === 0 ? 'empty-directory' : 'non-empty-directory';
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return 'missing';
    }

    throw error;
  }
}

export async function assertTargetDirectoryAvailable(
  targetDirectory: string,
): Promise<TargetState> {
  assertSafeTargetDirectory(targetDirectory);

  const state = await inspectTargetDirectory(targetDirectory);

  if (state === 'not-a-directory') {
    throw new CliError(
      'TARGET_NOT_DIRECTORY',
      `The target path is not a directory: ${targetDirectory}`,
      {
        exitCode: EXIT_CODES.targetConflict,
        path: targetDirectory,
        recovery: 'Choose a path that is missing or is an empty directory.',
      },
    );
  }

  if (state === 'non-empty-directory') {
    throw new CliError(
      'TARGET_NOT_EMPTY',
      `The target directory is not empty: ${targetDirectory}\nChoose a new directory or remove its contents first.`,
      {
        exitCode: EXIT_CODES.targetConflict,
        path: targetDirectory,
        recovery: 'Choose an empty directory or remove its contents first.',
      },
    );
  }

  return state;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

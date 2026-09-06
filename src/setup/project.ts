import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

import { CliError, EXIT_CODES } from '../errors.js';

const requiredProjectPaths = [
  'package.json',
  'wrangler.jsonc',
  '.dev.vars.example',
  'worker/index.ts',
  'agent/src/agent.py',
  'agent/.env.example',
] as const;
const requiredProjectDirectories = ['agent', 'worker'] as const;

export async function assertSpatiusProject(
  targetDirectory: string,
): Promise<void> {
  try {
    const target = await lstat(targetDirectory);
    if (!target.isDirectory() || target.isSymbolicLink()) {
      throw new Error('not a regular directory');
    }

    await Promise.all([
      ...requiredProjectDirectories.map(async (relativePath) => {
        const stats = await lstat(join(targetDirectory, relativePath));
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw new Error(`${relativePath} is not a regular directory`);
        }
      }),
      ...requiredProjectPaths.map(async (relativePath) => {
        const stats = await lstat(join(targetDirectory, relativePath));
        if (!stats.isFile() || stats.isSymbolicLink()) {
          throw new Error(`${relativePath} is not a regular file`);
        }
      }),
    ]);
  } catch {
    throw new CliError(
      'INVALID_ARGUMENT',
      'The target is not a compatible create-spatius-app project.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        path: targetDirectory,
        recovery:
          'Run this command from a generated project, or pass its directory explicitly.',
      },
    );
  }
}

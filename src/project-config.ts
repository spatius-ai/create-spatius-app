import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSelection, type StackId } from './catalog.js';
import { CliError, EXIT_CODES } from './errors.js';
export interface ProjectConfig {
  version: 2;
  stack: StackId;
}
export async function readProjectConfig(
  directory: string,
): Promise<ProjectConfig | undefined> {
  const path = join(directory, 'spatius.config.json');
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error('Expected a regular file');
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (
      value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version !== 2
    )
      throw new CliError(
        'INVALID_ARGUMENT',
        'Unsupported spatius.config.json version. Expected version 2.',
        { path, exitCode: EXIT_CODES.invalidArgument },
      );
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 2 ||
      !('stack' in value) ||
      typeof value.stack !== 'string'
    )
      throw new Error('Unsupported project configuration');
    return { version: 2, ...validateSelection(value.stack) };
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw new CliError('INVALID_ARGUMENT', 'Invalid spatius.config.json.', {
      path,
      exitCode: EXIT_CODES.invalidArgument,
    });
  }
}
export async function webEnvironmentPath(directory: string): Promise<string> {
  await readProjectConfig(directory);
  return '.dev.vars';
}

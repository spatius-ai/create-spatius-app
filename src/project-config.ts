import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSelection, type ScenarioId, type StackId } from './catalog.js';
import { CliError, EXIT_CODES } from './errors.js';
export interface ProjectConfig {
  version: 1;
  stack: StackId;
  template: ScenarioId;
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
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('stack' in value) ||
      typeof value.stack !== 'string' ||
      !('template' in value) ||
      typeof value.template !== 'string'
    )
      throw new Error('Unsupported project configuration');
    return { version: 1, ...validateSelection(value.stack, value.template) };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw new CliError('INVALID_ARGUMENT', 'Invalid spatius.config.json.', {
      path,
      exitCode: EXIT_CODES.invalidArgument,
    });
  }
}
export async function webEnvironmentPath(directory: string): Promise<string> {
  const config = await readProjectConfig(directory);
  return config?.stack.startsWith('railway') ? '.env.local' : '.dev.vars';
}

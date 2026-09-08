import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { runCredentialSetup } from './wizard.js';
import { mergeDotenv, parseDotenv, isPlaceholderValue } from './environment.js';
import { CliError, EXIT_CODES } from '../errors.js';
import { readProjectConfig } from '../project-config.js';
export const runAgoraSetup: typeof runCredentialSetup = async ({
  targetDirectory,
  prompts,
  onStatus = () => undefined,
}) => {
  const target = await lstat(targetDirectory);
  if (!target.isDirectory() || target.isSymbolicLink())
    throw new CliError(
      'INVALID_ARGUMENT',
      'Expected a regular project directory.',
      { exitCode: EXIT_CODES.invalidArgument },
    );
  const config = await readProjectConfig(targetDirectory);
  if (config?.stack !== 'zeabur-agora')
    throw new CliError(
      'INVALID_ARGUMENT',
      'Expected a Zeabur + Agora project.',
      { exitCode: EXIT_CODES.invalidArgument },
    );
  for (const name of [
    'package.json',
    '.env.local.example',
    'worker/agora.ts',
  ]) {
    const stats = await lstat(join(targetDirectory, name));
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new CliError(
        'INVALID_ARGUMENT',
        'Expected regular project files.',
        { exitCode: EXIT_CODES.invalidArgument },
      );
  }
  const path = join(targetDirectory, '.env.local');
  let existing: string | undefined;
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error('Unsafe credential path');
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw new CliError('FILESYSTEM_ERROR', 'Cannot safely read .env.local.', {
        exitCode: EXIT_CODES.filesystem,
        path,
      });
  }
  if (
    existing &&
    !(await prompts.confirm(
      'Replace existing Agora and Spatius credentials? Other variables are preserved.',
      false,
    ))
  )
    return 'unchanged';
  const values: Record<string, string> = {};
  const previous = parseDotenv(existing ?? '');
  const secretKeys = ['AGORA_APP_CERTIFICATE', 'SPATIUS_API_KEY'];
  for (const key of [
    'AGORA_APP_ID',
    'AGORA_APP_CERTIFICATE',
    'AGORA_PIPELINE_ID',
    'SPATIUS_APP_ID',
    'SPATIUS_API_KEY',
    'SPATIUS_AVATAR_ID',
    'SPATIUS_REGION',
    'AGORA_AVATAR_SAMPLE_RATE',
  ]) {
    const defaults: Record<string, string> = {
      SPATIUS_REGION: 'cn-beijing',
      AGORA_AVATAR_SAMPLE_RATE: '24000',
    };
    while (true) {
      const value = secretKeys.includes(key)
        ? await prompts.password(key)
        : await prompts.input(key, {
            initialValue: previous.get(key) ?? defaults[key],
          });
      if (isPlaceholderValue(value) || /\p{Cc}/u.test(value)) {
        onStatus('Enter a non-empty value without control characters.');
        continue;
      }
      if (
        ['AGORA_APP_ID', 'AGORA_APP_CERTIFICATE'].includes(key) &&
        !/^[a-f\d]{32}$/iu.test(value)
      ) {
        onStatus(
          'Agora App ID and certificate must contain 32 hexadecimal characters.',
        );
        continue;
      }
      if (
        key === 'AGORA_AVATAR_SAMPLE_RATE' &&
        ![8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(
          Number(value),
        )
      ) {
        onStatus('Choose a supported audio sample rate.');
        continue;
      }
      values[key] = value;
      break;
    }
  }
  const rendered = mergeDotenv(
    existing ??
      (await readFile(join(targetDirectory, '.env.local.example'), 'utf8')),
    values,
  );
  const temporary = join(targetDirectory, `.env.local.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, rendered, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  onStatus(
    'Saved .env.local. Configure an English assistant in the published Agora pipeline, with its TTS sample rate matching AGORA_AVATAR_SAMPLE_RATE. No cloud services were started.',
  );
  return 'configured';
};

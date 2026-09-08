import { webEnvironmentPath } from '../project-config.js';
import {
  chmod,
  lstat,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { CliError, EXIT_CODES } from '../errors.js';

export interface LiveKitCredentials {
  apiKey: string;
  apiSecret: string;
  url: string;
}

export interface SpatiusCredentials {
  backgroundUrl?: string;
  apiKey: string;
  appId: string;
  avatarId: string;
}

export interface CredentialBundle {
  voiceId?: string;
  liveKit: LiveKitCredentials;
  spatius: SpatiusCredentials;
}

export const WORKER_MANAGED_KEYS = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_AGENT_NAME',
  'SPATIUS_APP_ID',
  'SPATIUS_AVATAR_ID',
] as const;

export const AGENT_MANAGED_KEYS = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'SPATIUS_API_KEY',
  'SPATIUS_APP_ID',
] as const;

type ManagedKey =
  (typeof WORKER_MANAGED_KEYS)[number] | (typeof AGENT_MANAGED_KEYS)[number];

export interface CredentialFileContents {
  agent: string;
  worker: string;
}

export type CredentialConfigurationStatus =
  'complete' | 'inconsistent' | 'missing' | 'placeholder';

export interface CredentialFileState {
  agent?: string;
  hasManagedValues: boolean;
  status: CredentialConfigurationStatus;
  worker?: string;
}

const assignmentPattern =
  /^\s*(?:export\s+)?([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*)$/u;

function parseQuotedValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    const match = value.match(/^((?:"(?:\\.|[^"\\])*")).*$/u);
    if (match?.[1] !== undefined) {
      try {
        return JSON.parse(match[1]) as string;
      } catch {
        return match[1].slice(1, -1);
      }
    }
  }

  if (value.startsWith("'")) {
    const closingQuote = value.indexOf("'", 1);
    if (closingQuote !== -1) {
      return value.slice(1, closingQuote);
    }
  }

  return value.replace(/\s+#.*$/u, '').trim();
}

export function parseDotenv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(assignmentPattern);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values.set(match[1], parseQuotedValue(match[2]));
    }
  }

  return values;
}

export function isPlaceholderValue(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes('your-') ||
    normalized.includes('your_') ||
    normalized.includes('replace-me') ||
    normalized.includes('changeme') ||
    normalized.includes('placeholder') ||
    /^<[^>]+>$/u.test(normalized)
  );
}

function assertSafeValue(name: string, value: string): string {
  const normalized = value.trim();
  if (isPlaceholderValue(normalized)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `${name} must be a non-placeholder value.`,
      { exitCode: EXIT_CODES.invalidArgument },
    );
  }
  if (/\p{Cc}/u.test(normalized)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `${name} cannot contain control characters.`,
      { exitCode: EXIT_CODES.invalidArgument },
    );
  }

  return normalized;
}

export function validateLiveKitUrl(value: string): string {
  const normalized = assertSafeValue('LIVEKIT_URL', value);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new CliError(
      'INVALID_ARGUMENT',
      'LIVEKIT_URL must be a valid https:// or wss:// URL.',
      { exitCode: EXIT_CODES.invalidArgument },
    );
  }

  if (!['https:', 'wss:'].includes(parsed.protocol) || parsed.hostname === '') {
    throw new CliError(
      'INVALID_ARGUMENT',
      'LIVEKIT_URL must use https:// or wss://.',
      { exitCode: EXIT_CODES.invalidArgument },
    );
  }

  return normalized;
}

// Optional public presentation metadata is never required for credential completeness.
export function publicBackgroundUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function validateCredentialBundle(
  credentials: CredentialBundle,
): CredentialBundle {
  return {
    ...(credentials.voiceId === undefined
      ? {}
      : {
          voiceId: assertSafeValue('CARTESIA_VOICE_ID', credentials.voiceId),
        }),
    liveKit: {
      apiKey: assertSafeValue('LIVEKIT_API_KEY', credentials.liveKit.apiKey),
      apiSecret: assertSafeValue(
        'LIVEKIT_API_SECRET',
        credentials.liveKit.apiSecret,
      ),
      url: validateLiveKitUrl(credentials.liveKit.url),
    },
    spatius: {
      backgroundUrl: publicBackgroundUrl(credentials.spatius.backgroundUrl),
      apiKey: assertSafeValue('SPATIUS_API_KEY', credentials.spatius.apiKey),
      appId: assertSafeValue('SPATIUS_APP_ID', credentials.spatius.appId),
      avatarId: assertSafeValue(
        'SPATIUS_AVATAR_ID',
        credentials.spatius.avatarId,
      ),
    },
  };
}

function managedValues(
  contents: string | undefined,
  keys: readonly ManagedKey[],
): Map<string, string> {
  const parsed = parseDotenv(contents ?? '');
  return new Map(
    keys.flatMap((key) => {
      const value = parsed.get(key);
      return value === undefined ? [] : [[key, value] as const];
    }),
  );
}

export function inspectCredentialConfiguration(
  contents: Pick<CredentialFileState, 'agent' | 'worker'>,
  expectedAgentName = 'spatius-agent',
): Omit<CredentialFileState, 'agent' | 'worker'> {
  const worker = managedValues(contents.worker, WORKER_MANAGED_KEYS);
  const agent = managedValues(contents.agent, AGENT_MANAGED_KEYS);
  const allEntries = [...worker.entries(), ...agent.entries()];
  const hasManagedValues =
    allEntries.length > 0 ||
    parseDotenv(contents.worker ?? '').has('CARTESIA_VOICE_ID');
  const hasPlaceholder = allEntries.some(([, value]) =>
    isPlaceholderValue(value),
  );
  const allPresent =
    WORKER_MANAGED_KEYS.every((key) => worker.has(key)) &&
    AGENT_MANAGED_KEYS.every((key) => agent.has(key));
  const sharedKeys = [
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'SPATIUS_APP_ID',
  ] as const;
  const inconsistent =
    sharedKeys.some((key) => {
      const workerValue = worker.get(key);
      const agentValue = agent.get(key);
      return (
        workerValue !== undefined &&
        agentValue !== undefined &&
        !isPlaceholderValue(workerValue) &&
        !isPlaceholderValue(agentValue) &&
        workerValue !== agentValue
      );
    }) ||
    (worker.get('LIVEKIT_AGENT_NAME') !== undefined &&
      !isPlaceholderValue(worker.get('LIVEKIT_AGENT_NAME')) &&
      worker.get('LIVEKIT_AGENT_NAME') !== expectedAgentName);

  if (inconsistent) {
    return { hasManagedValues, status: 'inconsistent' };
  }
  if (!allPresent) {
    return { hasManagedValues, status: 'missing' };
  }
  if (hasPlaceholder) {
    return { hasManagedValues, status: 'placeholder' };
  }

  return { hasManagedValues, status: 'complete' };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readOptionalCredentialFile(
  path: string,
): Promise<string | undefined> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new CliError(
        'FILESYSTEM_ERROR',
        `Refusing to manage a credential path that is not a regular file: ${path}`,
        {
          exitCode: EXIT_CODES.filesystem,
          path,
          recovery: 'Replace it with a regular local file and rerun setup.',
        },
      );
    }

    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function readCredentialFileState(
  targetDirectory: string,
): Promise<CredentialFileState> {
  const webPath = await webEnvironmentPath(targetDirectory);
  const [worker, agent, workerExample] = await Promise.all([
    readOptionalCredentialFile(join(targetDirectory, webPath)),
    readOptionalCredentialFile(join(targetDirectory, 'agent', '.env.local')),
    readOptionalCredentialFile(join(targetDirectory, webPath + '.example')),
  ]);

  return {
    agent,
    ...inspectCredentialConfiguration(
      { agent, worker },
      parseDotenv(workerExample ?? '').get('LIVEKIT_AGENT_NAME'),
    ),
    worker,
  };
}

function serializeDotenvValue(value: string): string {
  return JSON.stringify(value);
}

export function mergeDotenv(
  baseContents: string,
  values: Readonly<Record<string, string>>,
): string {
  const seen = new Set<string>();
  const lines = baseContents.replace(/\r\n/gu, '\n').split('\n');
  const rendered = lines.map((line) => {
    const match = line.match(assignmentPattern);
    const key = match?.[1];
    if (key === undefined || !(key in values)) {
      return line;
    }

    seen.add(key);
    return `${key}=${serializeDotenvValue(values[key]!)}`;
  });

  while (rendered.at(-1) === '') {
    rendered.pop();
  }
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      rendered.push(`${key}=${serializeDotenvValue(value)}`);
    }
  }

  return `${rendered.join('\n')}\n`;
}

export function buildCredentialFileContents(
  state: CredentialFileState,
  examples: CredentialFileContents,
  rawCredentials: CredentialBundle,
): CredentialFileContents {
  const credentials = validateCredentialBundle(rawCredentials);
  const shared = {
    LIVEKIT_API_KEY: credentials.liveKit.apiKey,
    LIVEKIT_API_SECRET: credentials.liveKit.apiSecret,
    LIVEKIT_URL: credentials.liveKit.url,
    SPATIUS_APP_ID: credentials.spatius.appId,
  };

  return {
    agent: mergeDotenv(state.agent ?? examples.agent, {
      ...shared,
      SPATIUS_API_KEY: credentials.spatius.apiKey,
    }),
    worker: mergeDotenv(state.worker ?? examples.worker, {
      ...(credentials.voiceId === undefined
        ? {}
        : { CARTESIA_VOICE_ID: credentials.voiceId }),
      ...shared,
      LIVEKIT_AGENT_NAME:
        parseDotenv(examples.worker).get('LIVEKIT_AGENT_NAME') ??
        'spatius-agent',
      SPATIUS_AVATAR_ID: credentials.spatius.avatarId,
      // Clear a previous avatar’s background when a new selection has none.
      SPATIUS_AVATAR_BACKGROUND_URL: credentials.spatius.backgroundUrl ?? '',
    }),
  };
}

export interface AtomicCredentialFileSystem {
  chmod(path: string, mode: number): Promise<void>;
  lstat(path: string): ReturnType<typeof lstat>;
  readFile(path: string): Promise<Buffer>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string): Promise<void>;
  writeFile(
    path: string,
    contents: string | Buffer,
    options: { flag?: string; mode: number },
  ): Promise<void>;
}

const defaultAtomicFileSystem: AtomicCredentialFileSystem = {
  chmod,
  lstat,
  readFile: (path) => readFile(path),
  rename,
  rm: (path) => rm(path, { force: true }),
  writeFile,
};

interface AtomicTarget {
  backupMoved: boolean;
  backupPath: string;
  destinationPath: string;
  hadOriginal: boolean;
  installed: boolean;
  original?: Buffer;
  stagedPath: string;
}

async function pathExists(
  path: string,
  fileSystem: AtomicCredentialFileSystem,
): Promise<boolean> {
  try {
    await fileSystem.lstat(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

export async function writeCredentialFilesAtomically(
  targetDirectory: string,
  contents: CredentialFileContents,
  fileSystem: AtomicCredentialFileSystem = defaultAtomicFileSystem,
): Promise<void> {
  const webPath = await webEnvironmentPath(targetDirectory);
  const nonce = randomUUID();
  const targets: AtomicTarget[] = [
    {
      backupMoved: false,
      backupPath: join(targetDirectory, `.dev.vars.${nonce}.backup`),
      destinationPath: join(targetDirectory, webPath),
      hadOriginal: false,
      installed: false,
      stagedPath: join(targetDirectory, `.dev.vars.${nonce}.tmp`),
    },
    {
      backupMoved: false,
      backupPath: join(targetDirectory, 'agent', `.env.local.${nonce}.backup`),
      destinationPath: join(targetDirectory, 'agent', '.env.local'),
      hadOriginal: false,
      installed: false,
      stagedPath: join(targetDirectory, 'agent', `.env.local.${nonce}.tmp`),
    },
  ];
  const payloads = [contents.worker, contents.agent];

  try {
    for (const [index, target] of targets.entries()) {
      await fileSystem.writeFile(target.stagedPath, payloads[index]!, {
        flag: 'wx',
        mode: 0o600,
      });
      target.hadOriginal = await pathExists(target.destinationPath, fileSystem);
      if (target.hadOriginal) {
        target.original = await fileSystem.readFile(target.destinationPath);
      }
    }

    for (const target of targets) {
      if (target.hadOriginal) {
        await fileSystem.rename(target.destinationPath, target.backupPath);
        target.backupMoved = true;
      }
    }

    for (const target of targets) {
      await fileSystem.rename(target.stagedPath, target.destinationPath);
      target.installed = true;
      await fileSystem.chmod(target.destinationPath, 0o600);
    }

    for (const target of targets) {
      await fileSystem.rm(target.backupPath);
    }
  } catch {
    const unrestoredPaths: string[] = [];
    for (const target of [...targets].reverse()) {
      try {
        if (target.backupMoved) {
          if (!(await pathExists(target.backupPath, fileSystem))) {
            // Cleanup may already have removed this backup. Recreate it away
            // from the destination so a failed write cannot truncate that file.
            await fileSystem.writeFile(target.backupPath, target.original!, {
              flag: 'wx',
              mode: 0o600,
            });
          }
          await fileSystem.rename(target.backupPath, target.destinationPath);
        } else if (target.installed) {
          await fileSystem.rm(target.destinationPath);
        }
      } catch {
        unrestoredPaths.push(target.destinationPath);
      }
      // Leave untouched originals and failed recovery backups in place.
      await fileSystem.rm(target.stagedPath).catch(() => undefined);
    }

    throw new CliError(
      'FILESYSTEM_ERROR',
      'Could not save the local credential files. ' +
        (unrestoredPaths.length === 0
          ? 'Existing files were left unchanged or restored.'
          : 'Some credential files could not be restored. Any remaining backups were kept.'),
      {
        exitCode: EXIT_CODES.filesystem,
        path: targetDirectory,
        recovery:
          unrestoredPaths.length === 0
            ? 'Check file permissions, then rerun create-spatius-app setup . --interactive.'
            : `Check file permissions and inspect the affected files (${unrestoredPaths.join(', ')}) and remaining .backup files before rerunning setup.`,
      },
    );
  }
}

export async function readCredentialExamples(
  targetDirectory: string,
): Promise<CredentialFileContents> {
  const webPath = await webEnvironmentPath(targetDirectory);
  const [worker, agent] = await Promise.all([
    readFile(join(targetDirectory, webPath + '.example'), 'utf8'),
    readFile(join(targetDirectory, 'agent', '.env.example'), 'utf8'),
  ]);
  return { agent, worker };
}

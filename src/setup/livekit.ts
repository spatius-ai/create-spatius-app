import { createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { parse } from 'yaml';
import { join } from 'node:path';

import { PromptCancelledError } from '../errors.js';
import { createProcessInvocation } from '../package-managers.js';
import {
  type LiveKitCredentials,
  parseDotenv,
  validateCredentialBundle,
} from './environment.js';

export interface LiveKitCliProbe {
  available: boolean;
  reason?: 'incompatible' | 'missing';
  version?: string;
}

export interface LiveKitProject {
  name: string;
  url: string;
  isDefault: boolean;
}

// Read only display metadata; never expose stored keys or YAML parser errors.
export async function readLiveKitProjects(
  configPath = join(homedir(), '.livekit', 'cli-config.yaml'),
): Promise<LiveKitProject[]> {
  try {
    const config: unknown = parse(await readFile(configPath, 'utf8'));
    if (config == null) return [];
    if (
      typeof config !== 'object' ||
      !('projects' in config) ||
      !Array.isArray(config.projects)
    )
      throw new Error();
    return config.projects.map((project: Record<string, unknown>) => {
      if (
        typeof project?.name !== 'string' ||
        !/^[a-zA-Z0-9_-]+$/u.test(project.name) ||
        typeof project.url !== 'string'
      )
        throw new Error();
      const url = new URL(project.url);
      if (
        !['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
      return {
        name: project.name,
        url: url.toString().replace(/\/$/u, ''),
        isDefault:
          'default_project' in config &&
          project.name === config.default_project,
      };
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    // YAML parser errors can contain the API secret from the source line.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('Saved LiveKit projects could not be read.');
  }
}

interface CapturedCommandOptions {
  cwd?: string;
  timeoutMs?: number;
}

interface InteractiveCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface LiveKitCommandRunner {
  capture(
    command: string,
    args: readonly string[],
    options?: CapturedCommandOptions,
  ): Promise<string>;
  interactive(
    command: string,
    args: readonly string[],
    options: InteractiveCommandOptions,
  ): Promise<void>;
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) {
    child.kill('SIGKILL');
    return;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', '/f'],
        { stdio: 'ignore', windowsHide: true },
      );
      killer.once('close', () => resolvePromise());
      killer.once('error', () => resolvePromise());
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function captureCommand(
  command: string,
  args: readonly string[],
  { cwd, timeoutMs = 3000 }: CapturedCommandOptions = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const invocation = createProcessInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      ...(cwd === undefined ? {} : { cwd }),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let settled = false;

    const onData = (chunk: Buffer | string) => {
      if (output.length < 128_000) {
        output += chunk.toString();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void terminate(child).finally(() => {
        reject(new Error(`${command} timed out.`));
      });
    }, timeoutMs);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`${command} exited unsuccessfully.`));
        return;
      }
      resolvePromise(output.trim());
    });
  });
}

function interactiveCommand(
  command: string,
  args: readonly string[],
  { cwd, env }: InteractiveCommandOptions,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const invocation = createProcessInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      ...(env === undefined ? {} : { env }),
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => {
      reject(new Error('The LiveKit CLI could not be started.'));
    });
    child.once('close', (code, signal) => {
      if (signal === 'SIGINT' || signal === 'SIGTERM' || code === 130) {
        reject(new PromptCancelledError('LiveKit setup was cancelled.'));
        return;
      }
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error('The LiveKit CLI credential flow did not complete.'));
    });
  });
}

export const defaultLiveKitCommandRunner: LiveKitCommandRunner = {
  capture: captureCommand,
  interactive: interactiveCommand,
};

function parseVersion(output: string): string | undefined {
  return output.match(/\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?/u)?.[0];
}

export async function probeLiveKitCli(
  runner: LiveKitCommandRunner = defaultLiveKitCommandRunner,
): Promise<LiveKitCliProbe> {
  let versionOutput: string;
  try {
    versionOutput = await runner.capture('lk', ['--version']);
  } catch {
    return { available: false, reason: 'missing' };
  }

  try {
    const help = await runner.capture('lk', ['app', 'env', '--help']);
    if (
      !help.includes('--write') ||
      !help.includes('--destination') ||
      !help.includes('--example')
    ) {
      return {
        available: false,
        reason: 'incompatible',
        ...(parseVersion(versionOutput) === undefined
          ? {}
          : { version: parseVersion(versionOutput) }),
      };
    }

    return {
      available: true,
      ...(parseVersion(versionOutput) === undefined
        ? {}
        : { version: parseVersion(versionOutput) }),
    };
  } catch {
    return {
      available: false,
      reason: 'incompatible',
      ...(parseVersion(versionOutput) === undefined
        ? {}
        : { version: parseVersion(versionOutput) }),
    };
  }
}

export function createLiveKitEnvArguments(
  temporaryDirectory: string,
  projectName?: string,
): string[] {
  return [
    ...(projectName === undefined ? [] : ['--project', projectName]),
    'app',
    'env',
    '--write',
    '--destination',
    '.env.local',
    '--example',
    '.env.example',
    temporaryDirectory,
  ];
}

interface LiveKitTemporaryFileSystem {
  chmod(path: string, mode: number): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  writeFile(path: string, contents: string, mode: number): Promise<void>;
}

const defaultTemporaryFileSystem: LiveKitTemporaryFileSystem = {
  chmod,
  mkdtemp,
  readFile: (path) => readFile(path, 'utf8'),
  remove: (path) =>
    rm(path, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    }),
  writeFile: (path, contents, mode) => writeFile(path, contents, { mode }),
};

interface LoadLiveKitCredentialsOptions {
  projectName?: string;
  fileSystem?: LiveKitTemporaryFileSystem;
  runner?: LiveKitCommandRunner;
  temporaryRoot?: string;
}

export async function loadLiveKitCredentialsWithCli({
  fileSystem = defaultTemporaryFileSystem,
  runner = defaultLiveKitCommandRunner,
  temporaryRoot = tmpdir(),
  projectName,
}: LoadLiveKitCredentialsOptions = {}): Promise<LiveKitCredentials> {
  const directory = await fileSystem.mkdtemp(
    join(temporaryRoot, 'create-spatius-app-livekit-'),
  );

  try {
    await fileSystem.chmod(directory, 0o700);
    await fileSystem.writeFile(
      join(directory, '.env.example'),
      'LIVEKIT_URL=\nLIVEKIT_API_KEY=\nLIVEKIT_API_SECRET=\n',
      0o600,
    );
    await runner.interactive(
      'lk',
      createLiveKitEnvArguments(directory, projectName),
      {
        cwd: directory,
        ...(projectName === undefined
          ? {}
          : {
              env: Object.fromEntries(
                Object.entries(process.env).filter(
                  ([name]) => !name.startsWith('LIVEKIT_'),
                ),
              ),
            }),
      },
    );
    const values = parseDotenv(
      await fileSystem.readFile(join(directory, '.env.local')),
    );
    const validated = validateCredentialBundle({
      liveKit: {
        apiKey: values.get('LIVEKIT_API_KEY') ?? '',
        apiSecret: values.get('LIVEKIT_API_SECRET') ?? '',
        url: values.get('LIVEKIT_URL') ?? '',
      },
      spatius: {
        apiKey: 'validation-only',
        appId: 'validation-only',
        avatarId: 'validation-only',
      },
    });
    return validated.liveKit;
  } catch (error) {
    if (error instanceof PromptCancelledError) throw error;
    throw new Error(
      'LiveKit CLI did not return a complete, valid credential set.',
      { cause: error },
    );
  } finally {
    await fileSystem.remove(directory).catch(() => {
      throw new Error(
        'The temporary LiveKit credential directory could not be removed.',
      );
    });
  }
}

export class LiveKitCredentialProbeError extends Error {}

/** Verify the exact pair we will save, without creating a room. */
export async function verifyLiveKitCredentials(
  credentials: LiveKitCredentials,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(credentials.url);
  if (
    !['https:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new LiveKitCredentialProbeError(
      'LiveKit verification requires a clean https:// or wss:// URL.',
    );
  }
  url.protocol = 'https:';
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/twirp/livekit.RoomService/ListRooms`;
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: credentials.apiKey,
    nbf: now - 5,
    exp: now + 60,
    video: { roomList: true },
  })}`;
  const signature = createHmac('sha256', credentials.apiSecret)
    .update(unsigned)
    .digest('base64url');
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${unsigned}.${signature}`,
      },
      body: '{}',
    });
  } catch {
    throw new LiveKitCredentialProbeError(
      'Could not reach LiveKit to verify credentials (network, TLS, or timeout). Retry when connected.',
    );
  }
  // Never surface a provider response, which could contain sensitive data.
  if (!response.ok) await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403) {
    throw new LiveKitCredentialProbeError(
      'LiveKit rejected these credentials. The key may be revoked, rotated, or belong to another project. Reconnect or enter another pair.',
    );
  }
  if (!response.ok) {
    throw new LiveKitCredentialProbeError(
      `LiveKit verification failed (HTTP ${response.status}). Retry or check the project URL.`,
    );
  }
  try {
    const result: unknown = await response.json();
    if (
      result === null ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      ('rooms' in result && !Array.isArray(result.rooms))
    )
      throw new Error();
  } catch {
    throw new LiveKitCredentialProbeError(
      'LiveKit returned an unexpected verification response. Check the project URL and retry.',
    );
  }
}

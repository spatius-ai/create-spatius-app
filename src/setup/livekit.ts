import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

interface CapturedCommandOptions {
  cwd?: string;
  timeoutMs?: number;
}

interface InteractiveCommandOptions {
  cwd: string;
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
  { cwd }: InteractiveCommandOptions,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const invocation = createProcessInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => {
      reject(new Error('The LiveKit CLI could not be started.'));
    });
    child.once('close', (code) => {
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
): string[] {
  return [
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
  fileSystem?: LiveKitTemporaryFileSystem;
  runner?: LiveKitCommandRunner;
  temporaryRoot?: string;
}

export async function loadLiveKitCredentialsWithCli({
  fileSystem = defaultTemporaryFileSystem,
  runner = defaultLiveKitCommandRunner,
  temporaryRoot = tmpdir(),
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
    await runner.interactive('lk', createLiveKitEnvArguments(directory), {
      cwd: directory,
    });
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
  } catch {
    throw new Error(
      'LiveKit CLI did not return a complete, valid credential set.',
    );
  } finally {
    await fileSystem.remove(directory).catch(() => {
      throw new Error(
        'The temporary LiveKit credential directory could not be removed.',
      );
    });
  }
}

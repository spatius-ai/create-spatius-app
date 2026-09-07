import { execFile, spawn, type ChildProcess } from 'node:child_process';

import { CliError, EXIT_CODES } from './errors.js';

export const JAVASCRIPT_PACKAGE_MANAGERS = ['pnpm', 'bun', 'npm'] as const;
export const PYTHON_PACKAGE_MANAGERS = ['uv', 'pip'] as const;

export type JavaScriptPackageManager =
  (typeof JAVASCRIPT_PACKAGE_MANAGERS)[number];
export type PythonPackageManager = (typeof PYTHON_PACKAGE_MANAGERS)[number];

export interface CommandSpec {
  argsPrefix: string[];
  command: string;
  displayName: string;
}

export interface ProcessInvocation {
  args: string[];
  command: string;
}

export interface DetectedJavaScriptPackageManager {
  available: true;
  command: CommandSpec;
  name: JavaScriptPackageManager;
  version: string;
}

export interface DetectedPythonPackageManager {
  available: true;
  command: CommandSpec;
  name: PythonPackageManager;
  pythonRuntime?: CommandSpec;
  version: string;
}

export interface SelectedJavaScriptPackageManager {
  available: boolean;
  command: CommandSpec;
  name: JavaScriptPackageManager;
  version?: string;
}

export interface SelectedPythonPackageManager {
  available: boolean;
  command: CommandSpec;
  name: PythonPackageManager;
  pythonRuntime?: CommandSpec;
  version?: string;
}

export interface PackageManagerInventory {
  javascript: DetectedJavaScriptPackageManager[];
  python: DetectedPythonPackageManager[];
}

export interface SelectedPackageManagers {
  javascript: SelectedJavaScriptPackageManager;
  python?: SelectedPythonPackageManager;
}

export type ProbeCommand = (command: CommandSpec) => Promise<string>;

interface ProbePackageManagerOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

export function requiresWindowsCommandShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') {
    return false;
  }

  const executableName = command.split(/[\\/]/u).at(-1)?.toLowerCase();
  return (
    executableName !== undefined &&
    (['npm', 'pnpm', 'bun', 'uv', 'lk'].includes(executableName) ||
      executableName.endsWith('.cmd') ||
      executableName.endsWith('.bat'))
  );
}

export function createProcessInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): ProcessInvocation {
  if (!requiresWindowsCommandShell(command, platform)) {
    return { args: [...args], command };
  }

  return {
    args: ['/d', '/s', '/c', command, ...args],
    command: environment.ComSpec ?? environment.COMSPEC ?? 'cmd.exe',
  };
}

async function terminateProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform,
): Promise<void> {
  if (child.pid === undefined) {
    child.kill('SIGKILL');
    return;
  }

  if (platform === 'win32') {
    await new Promise<void>((resolvePromise) => {
      execFile(
        'taskkill.exe',
        ['/pid', String(child.pid), '/t', '/f'],
        { timeout: 2000, windowsHide: true },
        () => resolvePromise(),
      );
    });
    child.kill('SIGKILL');
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export function probePackageManagerCommand(
  command: CommandSpec,
  {
    platform = process.platform,
    timeoutMs = 3000,
  }: ProbePackageManagerOptions = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const invocation = createProcessInvocation(
      command.command,
      [...command.argsPrefix, '--version'],
      platform,
    );
    const child = spawn(invocation.command, invocation.args, {
      detached: platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let timedOut = false;
    let stderr = '';
    let stdout = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child, platform).finally(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(
          new Error(
            `${command.displayName} --version timed out after ${String(timeoutMs)}ms.`,
          ),
        );
      });
    }, timeoutMs);

    child.once('error', (error) => {
      if (settled || timedOut) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(error.message, { cause: error }));
    });
    child.once('close', (code, signal) => {
      if (settled || timedOut) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const reason =
          signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
        reject(new Error(`${command.displayName} failed with ${reason}.`));
        return;
      }

      resolvePromise(`${stdout}\n${stderr}`.trim());
    });
  });
}

function executable(command: string, ...argsPrefix: string[]): CommandSpec {
  return {
    argsPrefix,
    command,
    displayName: [command, ...argsPrefix].join(' '),
  };
}

function parseVersion(output: string): string {
  return output.match(/\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?/u)?.[0] ?? 'unknown';
}

async function detectJavaScriptManager(
  name: JavaScriptPackageManager,
  probe: ProbeCommand,
): Promise<DetectedJavaScriptPackageManager | undefined> {
  const command = executable(name);

  try {
    return {
      available: true,
      command,
      name,
      version: parseVersion(await probe(command)),
    };
  } catch {
    return undefined;
  }
}

function pythonRuntimeCandidates(platform: NodeJS.Platform): CommandSpec[] {
  return platform === 'win32'
    ? [executable('py', '-3'), executable('python'), executable('python3')]
    : [executable('python3'), executable('python')];
}

async function detectPip(
  probe: ProbeCommand,
  platform: NodeJS.Platform,
): Promise<DetectedPythonPackageManager | undefined> {
  for (const pythonRuntime of pythonRuntimeCandidates(platform)) {
    const command = executable(
      pythonRuntime.command,
      ...pythonRuntime.argsPrefix,
      '-m',
      'pip',
    );

    try {
      return {
        available: true,
        command,
        name: 'pip',
        pythonRuntime,
        version: parseVersion(await probe(command)),
      };
    } catch {
      // Try the next platform-appropriate Python launcher.
    }
  }

  return undefined;
}

async function detectUv(
  probe: ProbeCommand,
): Promise<DetectedPythonPackageManager | undefined> {
  const command = executable('uv');

  try {
    return {
      available: true,
      command,
      name: 'uv',
      version: parseVersion(await probe(command)),
    };
  } catch {
    return undefined;
  }
}

interface DetectPackageManagersOptions {
  javascript?: readonly JavaScriptPackageManager[];
  platform?: NodeJS.Platform;
  probe?: ProbeCommand;
  python?: readonly PythonPackageManager[];
}

export async function detectPackageManagers({
  javascript = JAVASCRIPT_PACKAGE_MANAGERS,
  platform = process.platform,
  probe = probePackageManagerCommand,
  python = PYTHON_PACKAGE_MANAGERS,
}: DetectPackageManagersOptions = {}): Promise<PackageManagerInventory> {
  const [javascriptResults, pythonResults] = await Promise.all([
    Promise.all(
      javascript.map(async (name) => detectJavaScriptManager(name, probe)),
    ),
    Promise.all(
      python.map(async (name) =>
        name === 'uv' ? detectUv(probe) : detectPip(probe, platform),
      ),
    ),
  ]);

  return {
    javascript: javascriptResults.filter(
      (manager): manager is DetectedJavaScriptPackageManager =>
        manager !== undefined,
    ),
    python: pythonResults.filter(
      (manager): manager is DetectedPythonPackageManager =>
        manager !== undefined,
    ),
  };
}

export function inferInvokingPackageManager(
  userAgent: string | undefined,
): JavaScriptPackageManager | undefined {
  const name = userAgent?.split(' ')[0]?.split('/')[0];
  return JAVASCRIPT_PACKAGE_MANAGERS.find((manager) => manager === name);
}

function unavailableJavaScriptManager(
  name: JavaScriptPackageManager,
): SelectedJavaScriptPackageManager {
  return {
    available: false,
    command: executable(name),
    name,
  };
}

function unavailablePythonManager(
  name: PythonPackageManager,
  platform: NodeJS.Platform,
): SelectedPythonPackageManager {
  if (name === 'uv') {
    return {
      available: false,
      command: executable('uv'),
      name,
    };
  }

  const pythonRuntime = pythonRuntimeCandidates(platform)[0]!;
  return {
    available: false,
    command: executable(
      pythonRuntime.command,
      ...pythonRuntime.argsPrefix,
      '-m',
      'pip',
    ),
    name,
    pythonRuntime,
  };
}

export function selectJavaScriptPackageManager(
  inventory: PackageManagerInventory,
  explicit: JavaScriptPackageManager | undefined,
  userAgent: string | undefined,
): SelectedJavaScriptPackageManager {
  if (explicit !== undefined) {
    return (
      inventory.javascript.find((manager) => manager.name === explicit) ??
      unavailableJavaScriptManager(explicit)
    );
  }

  const invoked = inferInvokingPackageManager(userAgent);
  const selected =
    inventory.javascript.find((manager) => manager.name === invoked) ??
    inventory.javascript[0];

  if (selected === undefined) {
    throw new CliError(
      'PACKAGE_MANAGER_NOT_FOUND',
      'No supported JavaScript package manager was found.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery: 'Install pnpm, Bun, or npm, then run the command again.',
      },
    );
  }

  return selected;
}

export function selectPythonPackageManager(
  inventory: PackageManagerInventory,
  explicit: PythonPackageManager | undefined,
  platform: NodeJS.Platform = process.platform,
): SelectedPythonPackageManager {
  if (explicit !== undefined) {
    return (
      inventory.python.find((manager) => manager.name === explicit) ??
      unavailablePythonManager(explicit, platform)
    );
  }

  const selected = inventory.python[0];
  if (selected === undefined) {
    throw new CliError(
      'PACKAGE_MANAGER_NOT_FOUND',
      'No supported Python package manager was found.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery:
          'Install uv, or install Python with pip, then run the command again.',
      },
    );
  }

  return selected;
}

export function assertPackageManagersAvailable(
  packageManagers: SelectedPackageManagers,
): void {
  const unavailable = [packageManagers.javascript, packageManagers.python].find(
    (manager) => manager !== undefined && !manager.available,
  );

  if (unavailable !== undefined) {
    throw new CliError(
      'PACKAGE_MANAGER_UNAVAILABLE',
      `${unavailable.name} was selected but is not available on PATH.`,
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery:
          'Install the selected package manager, choose an available one, or use --no-install.',
      },
    );
  }
}

export function javascriptInstallCommand(
  packageManager: JavaScriptPackageManager,
): string {
  return `${packageManager} install`;
}

export function javascriptRunCommand(
  packageManager: JavaScriptPackageManager,
  script: string,
): string {
  return `${packageManager} run ${script}`;
}

export function pythonInstallCommands(
  packageManager: SelectedPythonPackageManager,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (packageManager.name === 'uv') {
    return ['uv sync --directory agent --extra dev'];
  }

  const python =
    packageManager.pythonRuntime?.displayName ??
    (platform === 'win32' ? 'py -3' : 'python3');
  const virtualEnvironmentPython =
    platform === 'win32'
      ? 'agent\\.venv\\Scripts\\python.exe'
      : 'agent/.venv/bin/python';

  return [
    `${python} -m venv agent/.venv`,
    `${virtualEnvironmentPython} -m pip install -e "./agent[dev]"`,
  ];
}

import { describe, expect, it, vi } from 'vitest';

import {
  assertPackageManagersAvailable,
  createProcessInvocation,
  detectPackageManagers,
  inferInvokingPackageManager,
  probePackageManagerCommand,
  requiresWindowsCommandShell,
  pythonInstallCommands,
  selectJavaScriptPackageManager,
  selectPythonPackageManager,
  type CommandSpec,
  type ProbeCommand,
} from '../../src/package-managers.js';

function probeWith(outputs: Record<string, string>): ProbeCommand {
  return vi.fn((command: CommandSpec) => {
    const output = outputs[command.displayName];
    if (output === undefined) {
      return Promise.reject(new Error('not found'));
    }
    return Promise.resolve(output);
  });
}

describe('package-manager detection', () => {
  it.each([['pnpm', 'bun', 'npm'], ['bun', 'npm'], ['pnpm', 'npm'], ['npm']])(
    'orders available JavaScript choices by preference (%j)',
    async (...available) => {
      const inventory = await detectPackageManagers({
        probe: probeWith(
          Object.fromEntries(available.map((name) => [name, '1.2.3'])),
        ),
        python: [],
      });

      expect(inventory.javascript.map(({ name }) => name)).toEqual(available);
      expect(
        selectJavaScriptPackageManager(inventory, undefined, undefined).name,
      ).toBe(available[0]);
    },
  );

  it('returns only executable JavaScript and Python choices', async () => {
    const inventory = await detectPackageManagers({
      platform: 'linux',
      probe: probeWith({
        npm: '11.9.0',
        python3: 'Python 3.13.7',
        'python3 -m pip': 'pip 25.3 from /python/site-packages',
        uv: 'uv 0.8.17',
      }),
    });

    expect(inventory.javascript.map(({ name }) => name)).toEqual(['npm']);
    expect(inventory.python.map(({ name }) => name)).toEqual(['uv', 'pip']);
    expect(inventory.python[1]).toMatchObject({
      name: 'pip',
      pythonRuntime: { command: 'python3' },
      version: '25.3',
    });
  });

  it('probes executables without shell interpolation', async () => {
    await expect(
      probePackageManagerCommand({
        argsPrefix: ['-e', 'process.stdout.write("tool 1.2.3")', '--'],
        command: process.execPath,
        displayName: 'node probe',
      }),
    ).resolves.toContain('tool 1.2.3');
    await expect(
      probePackageManagerCommand({
        argsPrefix: ['-e', 'process.exit(9)', '--'],
        command: process.execPath,
        displayName: 'node failure',
      }),
    ).rejects.toThrow();
  });

  it('terminates a package-manager probe that exceeds its deadline', async () => {
    await expect(
      probePackageManagerCommand(
        {
          argsPrefix: ['-e', 'setTimeout(() => {}, 10_000)', '--'],
          command: process.execPath,
          displayName: 'slow probe',
        },
        { timeoutMs: 25 },
      ),
    ).rejects.toThrow('timed out after 25ms');
  });

  it('falls back to another Python launcher when needed', async () => {
    const inventory = await detectPackageManagers({
      platform: 'linux',
      probe: probeWith({
        npm: '11.9.0',
        'python -m pip': 'pip 25.3 from /python/site-packages',
      }),
    });

    expect(inventory.python).toHaveLength(1);
    expect(inventory.python[0]?.name).toBe('pip');
    expect(inventory.python[0]?.pythonRuntime?.command).toBe('python');
  });

  it('uses the invoking manager when it is available', async () => {
    const inventory = await detectPackageManagers({
      probe: probeWith({
        npm: '11.9.0',
        pnpm: '11.1.2',
        uv: 'uv 0.12.9',
      }),
    });

    expect(
      selectJavaScriptPackageManager(
        inventory,
        undefined,
        'pnpm/11.1.2 npm/? node/v24.0.0',
      ).name,
    ).toBe('pnpm');
    expect(
      selectJavaScriptPackageManager(inventory, undefined, 'npm/11.9.0').name,
    ).toBe('npm');
    expect(selectPythonPackageManager(inventory, undefined).name).toBe('uv');
  });

  it('recognizes supported invoking user agents', () => {
    expect(inferInvokingPackageManager('npm/11.9.0 node/v24')).toBe('npm');
    expect(inferInvokingPackageManager('bun/1.3.0')).toBe('bun');
    expect(inferInvokingPackageManager('yarn/4.9.0')).toBeUndefined();
    expect(inferInvokingPackageManager(undefined)).toBeUndefined();
  });

  it('uses the Windows shell only for command-script package managers', () => {
    expect(requiresWindowsCommandShell('npm', 'win32')).toBe(true);
    expect(requiresWindowsCommandShell('C:\\tools\\uv.cmd', 'win32')).toBe(
      true,
    );
    expect(
      requiresWindowsCommandShell('C:\\Python313\\python.exe', 'win32'),
    ).toBe(false);
    expect(requiresWindowsCommandShell('npm', 'linux')).toBe(false);
    expect(
      createProcessInvocation('npm', ['--version'], 'win32', {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      }),
    ).toEqual({
      args: ['/d', '/s', '/c', 'npm', '--version'],
      command: 'C:\\Windows\\System32\\cmd.exe',
    });
    expect(createProcessInvocation('npm', ['--version'], 'linux')).toEqual({
      args: ['--version'],
      command: 'npm',
    });
  });

  it('can limit detection to managers needed by a deterministic run', async () => {
    const calls: string[] = [];
    const inventory = await detectPackageManagers({
      javascript: ['pnpm'],
      probe: (command) => {
        calls.push(command.displayName);
        return Promise.resolve(
          command.displayName === 'pnpm' ? '11.1.2' : '0.12.9',
        );
      },
      python: ['uv'],
    });

    expect(calls.sort()).toEqual(['pnpm', 'uv']);
    expect(inventory.javascript[0]?.name).toBe('pnpm');
    expect(inventory.python[0]?.name).toBe('uv');
  });

  it('allows an unavailable explicit choice for no-install scaffolding', async () => {
    const inventory = await detectPackageManagers({
      probe: probeWith({ npm: '11.9.0', uv: 'uv 0.12.9' }),
    });

    const javascript = selectJavaScriptPackageManager(
      inventory,
      'bun',
      undefined,
    );
    const python = selectPythonPackageManager(inventory, 'pip', 'linux');
    const uv = selectPythonPackageManager({ javascript: [], python: [] }, 'uv');

    expect(javascript).toMatchObject({ available: false, name: 'bun' });
    expect(python).toMatchObject({
      available: false,
      name: 'pip',
      pythonRuntime: { command: 'python3' },
    });
    expect(uv).toMatchObject({ available: false, name: 'uv' });
    expect(() =>
      assertPackageManagersAvailable({ javascript, python }),
    ).toThrow('bun was selected');
  });

  it('fails clearly when no default choice can be detected', () => {
    const emptyInventory = { javascript: [], python: [] };

    expect(() =>
      selectJavaScriptPackageManager(emptyInventory, undefined, undefined),
    ).toThrow('No supported JavaScript package manager');
    expect(() => selectPythonPackageManager(emptyInventory, undefined)).toThrow(
      'No supported Python package manager',
    );
  });

  it('formats platform-appropriate pip setup commands', () => {
    const manager = selectPythonPackageManager(
      { javascript: [], python: [] },
      'pip',
      'win32',
    );

    expect(pythonInstallCommands(manager, 'win32')).toEqual([
      'py -3 -m venv agent/.venv',
      'agent\\.venv\\Scripts\\python.exe -m pip install -e "./agent[dev]"',
    ]);
  });
});

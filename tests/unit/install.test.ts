import { describe, expect, it, vi } from 'vitest';

import { installProjectDependencies } from '../../src/install.js';
import { createInstallPlan } from '../../src/templates/cloudflare-livekit/install.js';
import { createPackageManagers } from '../package-manager-fixtures.js';
import { createFixtureTemplate } from '../template-fixtures.js';

describe('dependency installation', () => {
  it('executes only the selected adapter plan and uses it for recovery', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('fixture failure'));
    const step = {
      args: ['prepare'],
      command: 'fixture',
      cwd: '/project',
      displayCommand: 'fixture prepare',
      label: 'Preparing fixture',
    };
    const createPlan = vi.fn(() => [step]);
    const packageManagers = createPackageManagers();
    await expect(
      installProjectDependencies({
        packageManagers,
        platform: 'linux',
        runner,
        targetDirectory: '/project',
        template: createFixtureTemplate({ createInstallPlan: createPlan }),
      }),
    ).rejects.toMatchObject({
      code: 'INSTALL_FAILED',
      recovery:
        'Keep the generated project and retry manually with fixture prepare.',
    });
    expect(createPlan).toHaveBeenCalledWith(
      '/project',
      packageManagers,
      'linux',
    );
    expect(runner).toHaveBeenCalledExactlyOnceWith(step, false);
  });

  it('runs JavaScript and uv installs without a shell command string', async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const onStep = vi.fn();

    await installProjectDependencies({
      onStep,
      packageManagers: createPackageManagers('pnpm', 'uv'),
      runner,
      silent: true,
      targetDirectory: '/project',
    });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]?.[0]).toMatchObject({
      args: ['install'],
      command: 'pnpm',
      cwd: '/project',
    });
    expect(runner.mock.calls[1]?.[0]).toMatchObject({
      args: ['sync', '--directory', 'agent', '--extra', 'dev'],
      command: 'uv',
      cwd: '/project',
    });
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('creates an isolated virtual environment before using pip', async () => {
    const runner = vi.fn().mockResolvedValue(undefined);

    await installProjectDependencies({
      packageManagers: createPackageManagers('npm', 'pip'),
      platform: 'linux',
      runner,
      targetDirectory: '/project',
    });

    expect(runner).toHaveBeenCalledTimes(3);
    expect(runner.mock.calls[1]?.[0]).toMatchObject({
      args: ['-m', 'venv', 'agent/.venv'],
      command: 'python3',
    });
    expect(runner.mock.calls[2]?.[0]).toMatchObject({
      args: ['-m', 'pip', 'install', '-e', '.[dev]'],
      command: '/project/agent/.venv/bin/python',
      cwd: '/project/agent',
    });
  });

  it('builds Windows virtual-environment paths independently of the host OS', () => {
    const steps = createInstallPlan(
      'C:\\project',
      createPackageManagers('npm', 'pip'),
      'win32',
    );

    expect(steps[2]).toMatchObject({
      command: 'C:\\project\\agent\\.venv\\Scripts\\python.exe',
      cwd: 'C:\\project\\agent',
    });
  });

  it('leaves recovery commands when installation fails', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('network unavailable'));
    let thrown: unknown;

    try {
      await installProjectDependencies({
        packageManagers: createPackageManagers('npm', 'uv'),
        runner,
        targetDirectory: '/project',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: 'INSTALL_FAILED',
      path: '/project',
    });
    expect((thrown as { recovery?: string }).recovery).toContain('npm install');
  });

  it('executes successful commands with the built-in process runner', async () => {
    const packageManagers = createPackageManagers('npm', 'uv');
    const executable = {
      argsPrefix: ['-e', 'process.exit(0)'],
      command: process.execPath,
      displayName: 'node success',
    };
    packageManagers.javascript.command = executable;
    packageManagers.python.command = executable;

    await expect(
      installProjectDependencies({
        packageManagers,
        silent: false,
        targetDirectory: process.cwd(),
      }),
    ).resolves.toBeUndefined();
  });

  it('captures command diagnostics from the built-in process runner', async () => {
    const packageManagers = createPackageManagers('npm', 'uv');
    packageManagers.javascript.command = {
      argsPrefix: [
        '-e',
        'process.stderr.write("simulated stderr"); process.exit(7)',
      ],
      command: process.execPath,
      displayName: 'node failure',
    };

    await expect(
      installProjectDependencies({
        packageManagers,
        silent: true,
        targetDirectory: process.cwd(),
      }),
    ).rejects.toThrow('simulated stderr');
  });

  it('rejects an unusable pip selection before spawning', () => {
    const packageManagers = createPackageManagers('npm', 'pip');
    delete packageManagers.python.pythonRuntime;

    expect(() =>
      createInstallPlan('/project', packageManagers, 'linux'),
    ).toThrow('without a Python runtime');
  });
});

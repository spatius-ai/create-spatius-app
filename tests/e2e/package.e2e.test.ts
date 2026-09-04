import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve('.');
const temporaryDirectories: string[] = [];

async function runNpm(
  arguments_: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{ stderr: string; stdout: string }> {
  const result = await execFileAsync('npm', arguments_, {
    ...options,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  return { stderr: String(result.stderr), stdout: String(result.stdout) };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-spatius-app-pack-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe('packed CLI', () => {
  it('runs outside the repository with its bundled template', async () => {
    const root = await createTemporaryDirectory();
    const npmCache = join(root, 'npm-cache');
    const packOutput = await runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
      {
        cwd: repositoryRoot,
        env: { ...process.env, npm_config_cache: npmCache },
      },
    );
    const packResult = JSON.parse(packOutput.stdout) as Array<{
      filename: string;
    }>;
    const filename = packResult[0]?.filename;
    expect(filename).toBeDefined();

    const installation = join(root, 'installation');
    await runNpm(
      [
        'install',
        '--prefix',
        installation,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--offline',
        join(root, filename!),
      ],
      { env: { ...process.env, npm_config_cache: npmCache } },
    );

    await runNpm(
      [
        '--prefix',
        installation,
        'exec',
        '--offline',
        '--',
        'create-spatius-app',
        '--yes',
        'packaged-app',
      ],
      {
        cwd: root,
        env: { ...process.env, NO_COLOR: '1', npm_config_cache: npmCache },
      },
    );

    await expect(
      readFile(join(root, 'packaged-app/.gitignore'), 'utf8'),
    ).resolves.toContain('node_modules/');
    await expect(readdir(join(root, 'packaged-app'))).resolves.toContain(
      'agent',
    );
  });
});

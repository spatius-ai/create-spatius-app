import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
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
  const windows = process.platform === 'win32';
  const command = windows
    ? (process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe')
    : 'npm';
  const commandArguments = windows
    ? ['/d', '/s', '/c', 'npm', ...arguments_]
    : arguments_;
  const result = await execFileAsync(command, commandArguments, {
    ...options,
    encoding: 'utf8',
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
      await rm(directory, {
        force: true,
        maxRetries: 10,
        recursive: true,
        retryDelay: 100,
      });
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
      files: Array<{ path: string }>;
    }>;
    const filename = packResult[0]?.filename;
    expect(filename).toBeDefined();
    const packedPaths = packResult[0]!.files.map((file) => file.path);
    expect(packedPaths.some((path) => path.startsWith('skills/'))).toBe(false);
    expect(packedPaths).toContain('templates/cloudflare-livekit/package.json');
    expect(packedPaths).toContain('dist/templates.js');
    expect(packedPaths.some((path) => path.startsWith('template/'))).toBe(
      false,
    );
    expect(
      packedPaths.some((path) =>
        /(?:^|\/)(?:test-results|playwright-report)(?:\/|$)/u.test(path),
      ),
    ).toBe(false);

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

    const setupHelp = await runNpm(
      [
        '--prefix',
        installation,
        'exec',
        '--offline',
        '--',
        'create-spatius-app',
        'setup',
        '--help',
      ],
      {
        cwd: root,
        env: { ...process.env, NO_COLOR: '1', npm_config_cache: npmCache },
      },
    );
    expect(setupHelp.stdout).toContain('create-spatius-app setup');

    // A lookalike cwd must never override assets in the installed package.
    await mkdir(join(root, 'templates/cloudflare-livekit'), {
      recursive: true,
    });
    await writeFile(
      join(root, 'templates/cloudflare-livekit/README.md'),
      'wrong template',
    );
    const generated = await runNpm(
      [
        '--prefix',
        installation,
        'exec',
        '--offline',
        '--',
        'create-spatius-app',
        '--yes',
        'packaged-app',
        '--package-manager',
        'npm',
        '--python-package-manager',
        'uv',
        '--no-install',
        '--json',
      ],
      {
        cwd: root,
        env: { ...process.env, NO_COLOR: '1', npm_config_cache: npmCache },
      },
    );
    const result = JSON.parse(generated.stdout) as {
      ok: boolean;
      template: string;
      nextSteps: string[];
    };
    expect(result).toMatchObject({
      ok: true,
      template: 'default',
      schemaVersion: 3,
      humanSteps: [{ requiresHuman: true, requiresTty: true }],
    });
    expect(result.nextSteps).toContain('npm run dev');
    const packageRoot = join(installation, 'node_modules/create-spatius-app');
    const schema = JSON.parse(
      await readFile(
        join(packageRoot, 'schemas/result-v3.schema.json'),
        'utf8',
      ),
    ) as { title: string };
    expect(schema.title).toBe('create-spatius-app result v3');
    const registryResult = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { pathToFileURL } from 'node:url';
       import { realpath } from 'node:fs/promises';
       const registry = await import(pathToFileURL(process.argv[1]).href);
       const selected = await registry.resolveProjectTemplate(process.argv[2]);
       console.log(JSON.stringify({ ids: Object.keys(registry.templateRegistry), selected: selected.id, directory: await realpath(registry.resolveTemplateDirectory()) }));`,
        join(packageRoot, 'dist/templates.js'),
        join(root, 'packaged-app'),
      ],
      { cwd: root },
    );
    expect(JSON.parse(registryResult.stdout)).toEqual({
      ids: ['cloudflare-livekit'],
      selected: 'cloudflare-livekit',
      directory: await realpath(
        join(packageRoot, 'templates/cloudflare-livekit'),
      ),
    });
    await expect(
      readFile(join(root, 'packaged-app/README.md'), 'utf8'),
    ).resolves.not.toContain('wrong template');

    await expect(
      readFile(join(root, 'packaged-app/.gitignore'), 'utf8'),
    ).resolves.toContain('node_modules/');
    await expect(readdir(join(root, 'packaged-app'))).resolves.toContain(
      'agent',
    );
    await expect(readdir(join(root, 'packaged-app'))).resolves.toContain(
      'package-lock.json',
    );
    await expect(readdir(join(root, 'packaged-app'))).resolves.not.toContain(
      '.npmrc',
    );
    await expect(
      readFile(join(root, 'packaged-app/worker/session.ts'), 'utf8'),
    ).resolves.toContain('RoomAgentDispatch');
    await expect(
      readFile(join(root, 'packaged-app/agent/.dockerignore'), 'utf8'),
    ).resolves.toContain('.venv');
    await expect(
      readFile(
        join(root, 'packaged-app/agent/tests/test_agent_startup.py'),
        'utf8',
      ),
    ).resolves.toContain(
      'test_connects_before_avatar_and_voice_session_startup',
    );
    await expect(
      readFile(join(root, 'packaged-app/scripts/run-agent-python.mjs'), 'utf8'),
    ).resolves.toBe(
      await readFile(
        join(
          packageRoot,
          'templates/cloudflare-livekit/scripts/run-agent-python.mjs',
        ),
        'utf8',
      ),
    );
    await expect(
      readFile(
        join(
          root,
          'packaged-app/contracts/agent-dispatch-metadata.schema.json',
        ),
        'utf8',
      ),
    ).resolves.toContain('"version"');
  }, 60_000);
});

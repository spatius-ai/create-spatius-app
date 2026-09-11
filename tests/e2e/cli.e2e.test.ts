import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, relative, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { documentedSkillCommands } from '../skill-fixtures.js';

const execFileAsync = promisify(execFile);
const cliPath = resolve('dist/cli.js');
const temporaryDirectories: string[] = [];
const temporaryServers: Server[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-spatius-app-e2e-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function runCli(
  arguments_: readonly string[],
  currentWorkingDirectory: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<{ stderr: string; stdout: string }> {
  const homeDirectory = await createTemporaryDirectory();
  return execFileAsync(process.execPath, [cliPath, ...arguments_], {
    cwd: currentWorkingDirectory,
    env: {
      ...process.env,
      HOME: homeDirectory,
      USERPROFILE: homeDirectory,
      ...environment,
      NO_COLOR: '1',
    },
  });
}

const defaultCreateOptions = [
  '--stack',
  'cloudflare-livekit',
  '--package-manager',
  'pnpm',
  '--python-package-manager',
  'uv',
  '--no-install',
] as const;

async function runCreateCli(
  arguments_: readonly string[],
  currentWorkingDirectory: string,
): Promise<{ stderr: string; stdout: string }> {
  return runCli(
    [...arguments_, ...defaultCreateOptions],
    currentWorkingDirectory,
  );
}

async function runInteractiveCli(
  answer: string,
  currentWorkingDirectory: string,
): Promise<{ stderr: string; stdout: string }> {
  const fakePath = await createFakeManagerPath(currentWorkingDirectory, 'pnpm');
  const result = await runSpawnedCli(
    ['--interactive', '--stack', 'cloudflare-livekit'],
    currentWorkingDirectory,
    `${answer}\n\n\nn\n`,
    { PATH: fakePath },
  );

  if (result.code !== 0) {
    throw new Error(
      `Interactive CLI exited with code ${String(result.code)}.\n${result.stderr}`,
    );
  }

  return result;
}

async function runSpawnedCli(
  arguments_: readonly string[],
  currentWorkingDirectory: string,
  input?: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const homeDirectory = await createTemporaryDirectory();
  const preload = join(
    await createTemporaryDirectory(),
    'mock-livekit-fetch.mjs',
  );
  await writeFile(
    preload,
    `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      if (String(input) === 'https://e2e.livekit.cloud/twirp/livekit.RoomService/ListRooms') {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return originalFetch(input, options);
    };
  `,
  );
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', pathToFileURL(preload).href, cliPath, ...arguments_],
      {
        cwd: currentWorkingDirectory,
        env: {
          ...process.env,
          HOME: homeDirectory,
          USERPROFILE: homeDirectory,
          ...environment,
          NO_COLOR: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    let stdout = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code, stderr, stdout });
    });
    child.stdin.end(input);
  });
}

async function expectGeneratedTree(target: string): Promise<void> {
  const entries = await readdir(target);
  expect(entries).toEqual(
    expect.arrayContaining([
      '.dev.vars.example',
      '.editorconfig',
      '.gitignore',
      '.npmrc',
      '.prettierignore',
      '.prettierrc.json',
      'AGENTS.md',
      'README.md',
      'agent',
      'contracts',
      'eslint.config.mjs',
      'index.html',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'scripts',
      'tsconfig.json',
      'tsconfig.node.json',
      'tsconfig.web.json',
      'tsconfig.worker.json',
      'vite.config.ts',
      'vitest.config.ts',
      'web',
      'worker',
      'wrangler.jsonc',
    ]),
  );
  await expect(readFile(join(target, 'AGENTS.md'), 'utf8')).resolves.toContain(
    'Cloudflare Worker',
  );
  await expect(readFile(join(target, 'web/App.tsx'), 'utf8')).resolves.toBe(
    await readFile(resolve('templates/cloudflare-livekit/web/App.tsx'), 'utf8'),
  );
  await expect(
    readFile(join(target, 'worker/session.ts'), 'utf8'),
  ).resolves.toContain('RoomAgentDispatch');
  await expect(
    readFile(join(target, 'agent/src/agent.py'), 'utf8'),
  ).resolves.toContain('spatius.AvatarSession');
  await expect(
    readFile(join(target, 'agent/.env.example'), 'utf8'),
  ).resolves.toContain('SPATIUS_API_KEY');
  await expect(
    readFile(
      join(target, 'contracts/agent-dispatch-metadata.schema.json'),
      'utf8',
    ),
  ).resolves.toContain('Spatius agent dispatch metadata');
  await expect(
    readFile(join(target, 'agent/.env.example'), 'utf8'),
  ).resolves.not.toContain('SPATIUS_AVATAR_ID');
  await expect(
    readFile(join(target, 'scripts/run-agent-python.mjs'), 'utf8'),
  ).resolves.toBe(
    await readFile(
      resolve('templates/cloudflare-livekit/scripts/run-agent-python.mjs'),
      'utf8',
    ),
  );
}

async function generatedFiles(
  directory: string,
  root = directory,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await generatedFiles(path, root)));
    else if (entry.isFile())
      files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files.sort();
}

async function createFakeExecutable(
  directory: string,
  name: string,
  version: string,
  executionExitCode = 0,
): Promise<void> {
  const unixPath = join(directory, name);
  await writeFile(
    unixPath,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\nexit ${String(executionExitCode)}\n`,
  );
  await chmod(unixPath, 0o755);
  await writeFile(
    `${unixPath}.cmd`,
    `@echo off\r\nif "%1"=="--version" (echo ${version} & exit /b 0)\r\nexit /b ${String(executionExitCode)}\r\n`,
  );
}

async function createFakeManagerPath(
  root: string,
  javascriptManager = 'npm',
): Promise<string> {
  const directory = join(root, 'fake-bin');
  await mkdir(directory);
  await createFakeExecutable(directory, javascriptManager, '11.9.0');
  await createFakeExecutable(directory, 'uv', '0.12.9');
  return directory;
}

async function addFakeLiveKitCli(directory: string): Promise<void> {
  const unixPath = join(directory, 'lk');
  await writeFile(
    unixPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "lk version 2.18.5"; exit 0; fi
if [ "$1" = "app" ] && [ "$2" = "env" ] && [ "$3" = "--help" ]; then echo "--write --destination --example"; exit 0; fi
if [ "$1" = "app" ] && [ "$2" = "env" ]; then
  for value in "$@"; do destination="$value"; done
  printf '%s\n' 'LIVEKIT_URL=wss://e2e.livekit.cloud' 'LIVEKIT_API_KEY=distinctive-livekit-key' 'LIVEKIT_API_SECRET=distinctive-livekit-secret' > "$destination/.env.local"
  exit 0
fi
exit 7
`,
  );
  await chmod(unixPath, 0o755);
  await writeFile(
    `${unixPath}.cmd`,
    `@echo off
if "%1"=="--version" (echo lk version 2.18.5 & exit /b 0)
if "%1"=="app" if "%2"=="env" if "%3"=="--help" (echo --write --destination --example & exit /b 0)
if "%1"=="app" if "%2"=="env" goto env
exit /b 7
:env
set "destination="
:args
if "%~1"=="" goto write
set "destination=%~1"
shift
goto args
:write
> "%destination%\\.env.local" echo LIVEKIT_URL=wss://e2e.livekit.cloud
>> "%destination%\\.env.local" echo LIVEKIT_API_KEY=distinctive-livekit-key
>> "%destination%\\.env.local" echo LIVEKIT_API_SECRET=distinctive-livekit-secret
exit /b 0
`,
  );
}

async function startMockSpatiusApi(authFailure = false): Promise<{
  appAuthenticated: () => boolean;
  baseUrl: string;
  revoked: () => boolean;
}> {
  let appAuthenticated = false;
  let revoked = false;
  let baseUrl = '';
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', baseUrl);
        const send = (value: unknown, status = 200) => {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(value));
        };

        if (
          request.method === 'POST' &&
          url.pathname === '/v1/cli/auth/sessions'
        ) {
          let body = '';
          for await (const chunk of request) body += String(chunk);
          if (authFailure) {
            send({
              errors: [
                {
                  code: 'INTERNAL_SERVER_ERROR',
                  status: 500,
                  detail: 'server open-platform frontend URL is not configured',
                },
              ],
            });
            return;
          }
          const input = JSON.parse(body) as {
            redirectUri: string;
            state: string;
          };
          send({
            authRequestId: 'e2e-auth-request',
            authorizeUrl: `${baseUrl}/authorize/e2e-auth-request`,
            expiresIn: 30,
          });
          setTimeout(() => {
            const callback = new URL(input.redirectUri);
            callback.searchParams.set('state', input.state);
            callback.searchParams.set('auth_request_id', 'e2e-auth-request');
            callback.searchParams.set('auth_code', 'distinctive-auth-code');
            void fetch(callback).catch(() => undefined);
          }, 10);
          return;
        }
        if (
          request.method === 'POST' &&
          url.pathname === '/v1/cli/auth/token'
        ) {
          send({
            token: {
              accessToken: 'distinctive-access-token',
              refreshToken: 'distinctive-refresh-token',
            },
          });
          return;
        }
        if (
          request.method === 'POST' &&
          url.pathname === '/v1/cli/auth/token:revoke'
        ) {
          revoked = true;
          send({});
          return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/apps') {
          send({ apps: [{ appId: 'e2e-app-id', name: 'E2E app' }] });
          return;
        }
        if (
          request.method === 'GET' &&
          url.pathname === '/v1/apps/e2e-app-id/api-keys'
        ) {
          send({
            apiKeys: [
              {
                apiKey: 'distinctive-spatius-api-key',
                createdAt: '2026-09-06T00:00:00Z',
              },
            ],
          });
          return;
        }
        if (
          request.method === 'GET' &&
          url.pathname === '/v2/console/public-avatars'
        ) {
          send({
            publicAvatars: [
              {
                id: 'e2e-public-avatar-id',
                name: 'E2E public avatar',
                backgroundImageUrl:
                  'https://cdn.example.com/public-background.jpg',
              },
            ],
          });
          return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/open/avatars') {
          appAuthenticated =
            request.headers['x-app-id'] === 'e2e-app-id' &&
            request.headers['x-api-key'] === 'distinctive-spatius-api-key';
          send({ avatars: [] });
          return;
        }
        send({ error: 'not found' }, 404);
      } catch {
        response.writeHead(500).end();
      }
    })();
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  temporaryServers.push(server);
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    appAuthenticated: () => appAuthenticated,
    baseUrl,
    revoked: () => revoked,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryServers.splice(0).map(
      (server) =>
        new Promise<void>((resolvePromise) => {
          server.close(() => resolvePromise());
          server.closeAllConnections();
        }),
    ),
  );
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

describe('built CLI', () => {
  it('generates Agora without a Python toolchain or agent files', async () => {
    const directory = await createTemporaryDirectory();
    const { stdout } = await runCli(
      [
        'agora-app',
        '--stack',
        'cloudflare-agora',
        '--package-manager',
        'npm',
        '--no-install',
        '--no-setup',
        '--json',
      ],
      directory,
    );
    const result: unknown = JSON.parse(stdout);
    expect(result).toMatchObject({
      ok: true,
      stack: 'cloudflare-agora',
      humanSteps: [{ requiresHuman: true, requiresTty: true }],
      packageManagers: { javascript: 'npm' },
    });
    expect(stdout).not.toContain('"python"');
    const files = await readdir(join(directory, 'agora-app'));
    expect(files).toContain('wrangler.jsonc');
    expect(files).toContain('.dev.vars.example');
    expect(files).not.toContain('agent');
    expect(files).not.toContain('Dockerfile');
    expect(files).not.toContain('server');
  });

  it.each(['pnpm', 'npm', 'bun'])(
    'prints a border-free, copyable command block for %s after the outro',
    async (manager) => {
      const root = await createTemporaryDirectory();
      const result = await runCli(
        [
          'app with spaces',
          '--package-manager',
          manager,
          '--python-package-manager',
          'uv',
          '--no-install',
          '--no-setup',
          '--no-interactive',
        ],
        root,
      );
      const lines = result.stdout.split('\n');
      const cdIndex = lines.findIndex(
        (line) => line.includes('cd ') && line.includes('app with spaces'),
      );
      const devIndex = lines.findIndex((line) =>
        line.includes(`${manager} run dev`),
      );
      expect(cdIndex).toBeGreaterThanOrEqual(0);
      expect(devIndex).toBeGreaterThan(cdIndex);
      expect(lines[cdIndex]).toMatch(/^cd /u);
      expect(lines[devIndex]).toBe(`${manager} run dev`);
      const commandBlock = lines.slice(cdIndex, devIndex + 1).join('\n');
      expect(commandBlock).not.toMatch(/[│◇╮╯├└]/u);
      expect(commandBlock).not.toContain('\u001b');
      expect(result.stdout).toContain(`Next steps:\n\n${commandBlock}\n\n`);
      expect(result.stdout.indexOf('Ready!')).toBeLessThan(
        result.stdout.indexOf('Next steps:'),
      );
      const preview = await runCli(
        ['preview-app', '--dry-run', '--no-interactive'],
        root,
      );
      expect(preview.stdout).not.toContain('Next steps');
      expect(preview.stdout).toContain('Dry run complete');
    },
  );

  it('creates a project at an explicit relative path', async () => {
    const root = await createTemporaryDirectory();

    const result = await runCreateCli(['example-app'], root);

    expect(result.stdout).toContain('example-app');
    await expectGeneratedTree(join(root, 'example-app'));
  });

  it('uses the default project name with --yes', async () => {
    const root = await createTemporaryDirectory();

    await runCreateCli(['--yes'], root);

    await expectGeneratedTree(join(root, 'my-spatius-app'));
  });

  it('uses the default project name when stdin is not a terminal', async () => {
    const root = await createTemporaryDirectory();

    await runCreateCli([], root);

    await expectGeneratedTree(join(root, 'my-spatius-app'));
  });

  it('accepts a project directory through the interactive prompt', async () => {
    const root = await createTemporaryDirectory();

    await runInteractiveCli('interactive-app', root);

    await expectGeneratedTree(join(root, 'interactive-app'));
  });

  it('accepts an existing empty directory', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'existing-empty');
    await mkdir(target);

    await runCreateCli(['existing-empty'], root);

    await expectGeneratedTree(target);
  });

  it('creates a project in the current empty directory', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'current-directory');
    await mkdir(target);

    await runCreateCli(['.'], target);

    await expectGeneratedTree(target);
  });

  it('shows help and version information', async () => {
    const root = await createTemporaryDirectory();

    const help = await runCli(['--help'], root);
    const version = await runCli(['--version'], root);

    expect(help.stdout).toContain('Usage: create-spatius-app');
    expect(help.stdout).toContain('--yes');
    expect(help.stdout).toContain('--no-interactive');
    expect(help.stdout).toContain('--package-manager');
    expect(help.stdout).toContain('--python-package-manager');
    expect(help.stdout).toContain('--no-install');
    expect(help.stdout).toContain('--json');
    expect(help.stdout).toContain('--dry-run');
    expect(help.stdout).toContain('--setup');
    expect(help.stdout).toContain('--no-setup');
    expect(help.stdout).toContain('--debug');
    expect(help.stdout).toContain('setup [options]');
    const metadata = JSON.parse(
      await readFile(resolve('package.json'), 'utf8'),
    ) as { version: string };
    expect(version.stdout.trim()).toBe(metadata.version);
  });

  it('documents the standalone credential command', async () => {
    const root = await createTemporaryDirectory();
    const help = await runCli(['setup', '--help'], root);

    expect(help.stdout).toContain('create-spatius-app setup');
    expect(help.stdout).toContain('--interactive');
    expect(help.stdout).toContain('--debug');
    expect(help.stdout).toContain('local provider credentials');
  });

  it('emits one structured JSON document without decorative output', async () => {
    const root = await createTemporaryDirectory();

    const result = await runCli(
      [
        'json-app',
        '--no-interactive',
        '--json',
        '--debug',
        ...defaultCreateOptions,
      ],
      root,
    );
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(output).toMatchObject({
      command: 'create',
      dryRun: false,
      ok: true,
      packageManagers: { javascript: 'pnpm', python: 'uv' },
      schemaVersion: 4,
      stack: 'cloudflare-livekit',
      wouldCreate: [],
    });
    expect(output.humanSteps).toEqual([
      {
        command: 'npx create-spatius-app setup . --interactive',
        reason: expect.any(String) as unknown,
        requiresHuman: true,
        requiresTty: true,
      },
    ]);
    expect(output.created).toContain('AGENTS.md');
    expect(output.created).toContain('web/App.tsx');
    expect(output.nextSteps).toContain(
      'npx create-spatius-app setup . --interactive',
    );
    expect(output.nextSteps).toContain('pnpm run dev');
    expect(output.created).toEqual(
      await generatedFiles(join(root, 'json-app')),
    );
    await expectGeneratedTree(join(root, 'json-app'));
  });

  it('reports a JSON dry run without modifying the filesystem', async () => {
    const root = await createTemporaryDirectory();

    const result = await runCli(
      ['dry-app', '--dry-run', '--json', ...defaultCreateOptions],
      root,
    );
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(output).toMatchObject({
      created: [],
      dryRun: true,
      ok: true,
    });
    expect(output.humanSteps).toEqual([
      expect.objectContaining({ requiresHuman: true, requiresTty: true }),
    ]);
    expect(output.wouldCreate).toContain('AGENTS.md');
    expect(output.wouldCreate).toContain('agent/src/agent.py');
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('uses the same selected default file plan for dry-run and creation', async () => {
    const root = await createTemporaryDirectory();
    for (const [javascript, python] of [
      ['pnpm', 'uv'],
      ['npm', 'pip'],
      ['bun', 'uv'],
    ] as const) {
      const options = [
        '--json',
        '--no-interactive',
        '--no-install',
        '--package-manager',
        javascript,
        '--python-package-manager',
        python,
      ];
      const dryRun = JSON.parse(
        (await runCli(['dry-' + javascript, '--dry-run', ...options], root))
          .stdout,
      ) as { stack: string; wouldCreate: string[] };
      const target = join(root, 'created-' + javascript);
      const created = JSON.parse(
        (await runCli([target, ...options], root)).stdout,
      ) as { stack: string; created: string[]; nextSteps: string[] };
      expect(dryRun.stack).toBe('cloudflare-livekit');
      expect(created.stack).toBe('cloudflare-livekit');
      expect(created.created).toEqual(dryRun.wouldCreate);
      expect(created.created).toEqual(await generatedFiles(target));
      expect(created.nextSteps.at(-1)).toBe(`${javascript} run dev`);
      const metadata = JSON.parse(
        await readFile(join(target, 'package.json'), 'utf8'),
      ) as { scripts: Record<string, string> };
      expect(metadata.scripts.dev).toBe(
        `node scripts/dev.mjs "${javascript} run dev:web" "${javascript} run agent:dev"`,
      );
      expect(metadata.scripts['agent:dev']).toBe('node scripts/dev-agent.mjs');
      expect(metadata.scripts['dev:web']).toBe('node scripts/dev-web.mjs');
      expect(metadata.scripts.check).toContain(`${javascript} run test:dev`);
    }
  });

  it('rejects the removed --template option before creating files', async () => {
    const root = await createTemporaryDirectory();
    const result = await runSpawnedCli(
      ['--template', 'cloudflare-livekit', '--json'],
      root,
    );
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('returns structured errors and stable exit statuses in JSON mode', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'existing');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'keep me');

    const result = await runSpawnedCli(
      ['existing', '--no-interactive', '--json', ...defaultCreateOptions],
      root,
    );
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    const canonicalTarget = await realpath(target);

    expect(result.code).toBe(3);
    expect(result.stderr).toBe('');
    expect(output).toMatchObject({
      error: {
        code: 'TARGET_NOT_EMPTY',
      },
      ok: false,
      schemaVersion: 4,
    });
    const error = output.error as { path: unknown };
    expect(typeof error.path).toBe('string');
    await expect(realpath(error.path as string)).resolves.toBe(canonicalTarget);
    await expect(readdir(target)).resolves.toEqual(['keep.txt']);
  });

  it('returns exit status 2 for invalid agent-facing options', async () => {
    const root = await createTemporaryDirectory();

    const result = await runSpawnedCli(
      ['--json', '--interactive', 'example'],
      root,
    );

    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
      ok: false,
    });
  });

  it('rejects conflicting or non-interactive setup requests before scaffolding', async () => {
    const root = await createTemporaryDirectory();
    for (const arguments_ of [
      ['conflict', '--setup', '--no-setup'],
      ['dry', '--setup', '--dry-run'],
      ['yes', '--setup', '--yes'],
      ['non-tty', '--setup'],
    ]) {
      const result = await runSpawnedCli(
        [...arguments_, ...defaultCreateOptions],
        root,
      );
      expect(result.code).toBe(2);
    }
    expect(await readdir(root)).toEqual([]);

    const setupJson = await runSpawnedCli(['setup', '.', '--json'], root);
    expect(setupJson.code).toBe(2);
    expect(JSON.parse(setupJson.stdout)).toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
      ok: false,
    });
  });

  it.each([
    [
      '--dry-run',
      'Credential setup cannot run in JSON, dry-run, yes, or CI mode.',
    ],
    ['--yes', '--yes cannot be combined with --interactive.'],
    ['-y', '--yes cannot be combined with --interactive.'],
    ['--json', '--json cannot be combined with --interactive.'],
  ])(
    'standalone setup rejects inherited %s before entering the interactive wizard',
    async (flag, message) => {
      const root = await createTemporaryDirectory();

      for (const arguments_ of [
        [flag, 'setup', '.', '--interactive'],
        ['setup', '.', '--interactive', flag],
      ]) {
        const result = await runSpawnedCli(arguments_, root, '', {
          AI_AGENT: 'codex',
          CI: '',
          CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
          NODE_ENV: 'test',
        });

        expect(result.code).toBe(2);
        if (flag === '--json') {
          expect(result.stderr).toBe('');
          expect(JSON.parse(result.stdout)).toMatchObject({
            error: { code: 'INVALID_ARGUMENT', message },
            ok: false,
          });
        } else {
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain(message);
        }
        expect(await readdir(root)).toEqual([]);
      }
    },
  );

  it('standalone setup rejects an inherited --no-setup before inspecting the project', async () => {
    const root = await createTemporaryDirectory();
    const message = 'The setup command cannot be combined with --no-setup.';

    for (const json of [false, true]) {
      for (const arguments_ of [
        ['--no-setup', 'setup', '.', '--interactive'],
        ['setup', '.', '--interactive', '--no-setup'],
      ]) {
        const result = await runSpawnedCli(
          [...arguments_, ...(json ? ['--json'] : [])],
          root,
          '',
          {
            AI_AGENT: 'codex',
            CI: '',
            CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
            NODE_ENV: 'test',
          },
        );

        expect(result.code).toBe(2);
        if (json) {
          expect(result.stderr).toBe('');
          expect(JSON.parse(result.stdout)).toMatchObject({
            error: { code: 'INVALID_ARGUMENT', message },
            ok: false,
          });
        } else {
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain(message);
        }
        expect(await readdir(root)).toEqual([]);
      }
    }
  });

  it.each([
    ['--interactive', '--no-interactive'],
    ['--install', '--no-install'],
    ['--setup', '--no-setup'],
  ])(
    'rejects conflicting %s and %s on either side of the setup subcommand',
    async (positive, negative) => {
      const root = await createTemporaryDirectory();
      for (const arguments_ of [
        ['setup', '.', positive, negative],
        ['setup', '.', negative, positive],
        [positive, 'setup', '.', negative],
        [negative, 'setup', '.', positive],
      ]) {
        const result = await runSpawnedCli(arguments_, root, '', {
          AI_AGENT: 'codex',
          CI: '',
          CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
          NODE_ENV: 'test',
        });
        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('cannot be combined');
        expect(await readdir(root)).toEqual([]);
      }
    },
  );

  it('lets a human decline integrated setup without changing the project', async () => {
    const root = await createTemporaryDirectory();
    const fakePath = await createFakeManagerPath(root, 'pnpm');
    const result = await runSpawnedCli(
      ['human-app', '--interactive', ...defaultCreateOptions],
      root,
      'n\n',
      {
        AI_AGENT: '',
        CI: '',
        CODEX_CI: '',
        CODEX_SANDBOX: '',
        CODEX_THREAD_ID: '',
        CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
        NODE_ENV: 'test',
        PATH: fakePath,
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'Configure provider and Spatius credentials now?',
    );
    await expect(
      readFile(join(root, 'human-app/.dev.vars'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not treat --interactive alone as agent authorization for setup', async () => {
    const root = await createTemporaryDirectory();
    const fakePath = await createFakeManagerPath(root, 'pnpm');
    const result = await runSpawnedCli(
      ['agent-app', '--interactive', ...defaultCreateOptions],
      root,
      '',
      {
        AI_AGENT: 'codex',
        CI: '',
        CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
        NODE_ENV: 'test',
        PATH: fakePath,
      },
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(
      'Configure provider and Spatius credentials now?',
    );
    await expect(
      readFile(join(root, 'agent-app/.dev.vars'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps CI creation non-interactive and rejects explicit CI authentication', async () => {
    const root = await createTemporaryDirectory();
    await runCli(['ci-app', ...defaultCreateOptions], root, { CI: '1' });
    await expect(
      readFile(join(root, 'ci-app/.dev.vars'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const explicit = await runSpawnedCli(
      ['ci-explicit', '--setup', '--interactive', ...defaultCreateOptions],
      root,
      undefined,
      { CI: '1' },
    );
    expect(explicit.code).toBe(2);
    await expect(readdir(root)).resolves.not.toContain('ci-explicit');
  });

  it.each([
    ['feminine', '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc'],
    ['masculine', 'a167e0f3-df7e-4d52-a9c3-f949145efdab'],
  ])(
    'configures both local files with a %s voice and reruns standalone',
    async (style, voiceId) => {
      const root = await createTemporaryDirectory();
      const target = join(root, 'configured-app');
      const fakePath = await createFakeManagerPath(root, 'pnpm');
      await addFakeLiveKitCli(fakePath);
      const api = await startMockSpatiusApi();
      const environment = {
        AI_AGENT: 'codex',
        CI: '',
        CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
        CREATE_SPATIUS_APP_TEST_NO_BROWSER: '1',
        CREATE_SPATIUS_APP_TEST_SPATIUS_BASE_URL: api.baseUrl,
        NODE_ENV: 'test',
        PATH: `${fakePath}${delimiter}${process.env.PATH ?? ''}`,
      };
      const result = await runSpawnedCli(
        [
          'configured-app',
          '--setup',
          '--interactive',
          '--debug',
          ...defaultCreateOptions,
        ],
        root,
        `\n\n\n\n\n${style}\n`,
        environment,
      );

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toContain('Save the local configuration');
      expect(result.stdout).toContain('pnpm run dev');
      const worker = await readFile(join(target, '.dev.vars'), 'utf8');
      const agent = await readFile(join(target, 'agent/.env.local'), 'utf8');
      expect(worker).toContain('LIVEKIT_URL="wss://e2e.livekit.cloud"');
      expect(worker).toMatch(
        /LIVEKIT_AGENT_NAME="spatius-agent-[a-f0-9-]{36}"/u,
      );
      expect(worker).toContain(`CARTESIA_VOICE_ID="${voiceId}"`);
      expect(agent).not.toContain('CARTESIA_VOICE_ID');
      expect(worker).toContain('SPATIUS_APP_ID="e2e-app-id"');
      expect(worker).toContain('SPATIUS_AVATAR_ID="e2e-public-avatar-id"');
      expect(worker).toContain(
        'SPATIUS_AVATAR_BACKGROUND_URL="https://cdn.example.com/public-background.jpg"',
      );
      expect(agent).not.toContain('SPATIUS_AVATAR_BACKGROUND_URL');
      expect(agent).toContain('SPATIUS_API_KEY="distinctive-spatius-api-key"');
      expect(agent).not.toContain('SPATIUS_AVATAR_ID');
      expect(api.appAuthenticated()).toBe(true);
      expect(api.revoked()).toBe(true);
      expect(result.stderr).toContain('[debug] Spatius');
      expect(result.stderr).toContain('"route":"/v1/cli/auth/token:revoke"');
      expect(result.stderr).toContain('"route":"/v1/apps/{appId}/api-keys"');
      for (const secret of [
        'distinctive-livekit-key',
        'distinctive-livekit-secret',
        'distinctive-spatius-api-key',
        'distinctive-auth-code',
        'distinctive-access-token',
        'distinctive-refresh-token',
      ]) {
        expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
      }

      const rerun = await runSpawnedCli(
        ['setup', '--interactive'],
        target,
        '\n',
        environment,
      );
      expect(rerun.code, rerun.stderr).toBe(0);
      expect(rerun.stdout).toContain('left unchanged');
      await expect(readFile(join(target, '.dev.vars'), 'utf8')).resolves.toBe(
        worker,
      );
      await expect(
        readFile(join(target, 'agent/.env.local'), 'utf8'),
      ).resolves.toBe(agent);
    },
    15_000,
  );

  it('reports console errors inside HTTP 200 responses, with opt-in safe diagnostics', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'auth-failure-app');
    await runCreateCli(['auth-failure-app'], root);
    const fakePath = await createFakeManagerPath(root, 'pnpm');
    await addFakeLiveKitCli(fakePath);
    const api = await startMockSpatiusApi(true);
    const environment = {
      AI_AGENT: 'codex',
      CI: '',
      CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
      CREATE_SPATIUS_APP_TEST_NO_BROWSER: '1',
      CREATE_SPATIUS_APP_TEST_SPATIUS_BASE_URL: api.baseUrl,
      NODE_ENV: 'test',
      PATH: `${fakePath}${delimiter}${process.env.PATH ?? ''}`,
    };

    for (const debug of [true, false]) {
      const result = await runSpawnedCli(
        ['setup', '--interactive', ...(debug ? ['--debug'] : [])],
        target,
        '\n\nn\n',
        environment,
      );
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.code, output).toBe(130);
      expect(output).toContain('SERVER_OPEN_PLATFORM_FRONTEND_URL');
      expect(output).toContain('HTTP 200, API 500 INTERNAL_SERVER_ERROR');
      expect(output).not.toContain('without authRequestId');
      expect(output).not.toContain('distinctive-livekit-key');
      expect(output).not.toContain('distinctive-livekit-secret');
      if (debug) {
        expect(result.stderr).toContain('[debug] Spatius');
        expect(result.stderr).toContain('"httpStatus":200');
        expect(result.stderr).toContain('"apiStatus":500');
        expect(result.stderr).toContain('"apiCode":"INTERNAL_SERVER_ERROR"');
      } else {
        expect(output).not.toContain('[debug]');
      }
      await expect(readdir(target)).resolves.not.toContain('.dev.vars');
      await expect(readdir(join(target, 'agent'))).resolves.not.toContain(
        '.env.local',
      );
    }
  }, 15_000);

  it('offers installation guidance and defers missing-CLI setup without writing credentials', async () => {
    const root = await createTemporaryDirectory();
    await runCreateCli(['deferred-app', '--yes'], root);
    const target = join(root, 'deferred-app');
    const fakePath = await createFakeManagerPath(root);
    const result = await runSpawnedCli(
      ['setup', '--interactive'],
      target,
      'skip\n',
      {
        AI_AGENT: 'codex',
        CI: '',
        NODE_ENV: 'test',
        CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
        PATH: fakePath,
      },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain(
      'LiveKit CLI was not found',
    );
    expect(result.stdout).toContain('https://docs.livekit.io/');
    expect(result.stdout).toContain('Credential setup deferred');
    expect(await generatedFiles(target)).not.toContain('.dev.vars');
    expect(await generatedFiles(target)).not.toContain('agent/.env.local');
  });

  it.skipIf(process.platform === 'win32')(
    'installs a missing CLI through the wizard and immediately extracts credentials',
    async () => {
      const root = await createTemporaryDirectory();
      await runCreateCli(['install-app', '--yes'], root);
      const target = join(root, 'install-app');
      const fakePath = await createFakeManagerPath(root);
      const stagedPath = join(root, 'staged');
      await mkdir(stagedPath);
      await addFakeLiveKitCli(stagedPath);
      const installer = process.platform === 'darwin' ? 'brew' : 'bash';
      const installerPath = join(fakePath, installer);
      await writeFile(
        installerPath,
        `#!/bin/sh
if [ "$1" = "--version" ]; then echo 1.0; exit 0; fi
/bin/cp "$LK_TEST_STAGED/lk" "$LK_TEST_BIN/lk"
`,
      );
      await chmod(installerPath, 0o755);
      await createFakeExecutable(fakePath, 'curl', '8.0');
      const result = await runSpawnedCli(
        ['setup', '--interactive'],
        target,
        'install\nmanual\nspatius-key\napp-id\navatar-id\nfeminine\n',
        {
          AI_AGENT: 'codex',
          CI: '',
          NODE_ENV: 'test',
          CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
          PATH: fakePath,
          LK_TEST_STAGED: stagedPath,
          LK_TEST_BIN: fakePath,
        },
      );
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain('Install command:');
      expect(result.stdout).toContain('LiveKit CLI is ready');
      const worker = await readFile(join(target, '.dev.vars'), 'utf8');
      expect(worker).toContain('LIVEKIT_URL="wss://e2e.livekit.cloud"');
      expect(result.stdout + result.stderr).not.toContain(
        'distinctive-livekit-secret',
      );
    },
  );

  it('standalone setup rejects unrelated directories before reading credentials', async () => {
    const root = await createTemporaryDirectory();
    const unrelated = await runSpawnedCli(
      ['setup', '--interactive'],
      root,
      '',
      {
        AI_AGENT: 'codex',
        CI: '',
        CREATE_SPATIUS_APP_TEST_INTERACTIVE: '1',
        NODE_ENV: 'test',
      },
    );
    expect(unrelated.code).toBe(2);
    expect(unrelated.stderr).toContain('not a compatible');
    expect(await readdir(root)).toEqual([]);
  });

  it('returns a structured usage error for an unknown option', async () => {
    const root = await createTemporaryDirectory();

    const result = await runSpawnedCli(['--json', '--unknown-option'], root);

    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: {
        code: 'INVALID_ARGUMENT',
      },
      ok: false,
    });
    expect(result.stdout).toContain('--help');
  });

  it('returns exit status 130 when an interactive prompt is cancelled', async () => {
    const root = await createTemporaryDirectory();

    const result = await runSpawnedCli(
      ['--interactive', '--stack', 'cloudflare-livekit'],
      root,
    );

    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Cancelled [CANCELLED]');
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('rejects a non-empty directory without changing its contents', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'existing');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'keep me');

    await expect(runCreateCli(['existing'], root)).rejects.toMatchObject({
      code: 3,
    });

    await expect(readdir(target)).resolves.toEqual(['keep.txt']);
    await expect(readFile(join(target, 'keep.txt'), 'utf8')).resolves.toBe(
      'keep me',
    );
  });

  it('renders an npm and pip project without unrelated lockfiles', async () => {
    const root = await createTemporaryDirectory();

    await runCli(
      [
        'npm-pip-app',
        '--package-manager',
        'npm',
        '--python-package-manager',
        'pip',
        '--no-install',
      ],
      root,
    );

    const target = join(root, 'npm-pip-app');
    const entries = await readdir(target);
    const packageMetadata = JSON.parse(
      await readFile(join(target, 'package.json'), 'utf8'),
    ) as { name: string; packageManager?: string };
    const readme = await readFile(join(target, 'README.md'), 'utf8');
    const dockerfile = await readFile(join(target, 'agent/Dockerfile'), 'utf8');

    expect(entries).not.toContain('.npmrc');
    expect(entries).not.toContain('pnpm-lock.yaml');
    expect(entries).not.toContain('pnpm-workspace.yaml');
    expect(entries).toContain('package-lock.json');
    expect(await readdir(join(target, 'agent'))).not.toContain('uv.lock');
    expect(packageMetadata.name).toBe('npm-pip-app');
    expect(packageMetadata.packageManager).toBeUndefined();
    expect(readme).toContain('npm install');
    expect(readme).toContain(
      process.platform === 'win32'
        ? 'py -3 -m venv agent/.venv'
        : 'python3 -m venv agent/.venv',
    );
    expect(readme).not.toContain('SPATIUS_JAVASCRIPT_PACKAGE_MANAGER');
    expect(readme).not.toContain('__SPATIUS_');
    expect(dockerfile).toContain('python -m pip install');
  });

  it('presents pnpm first, Bun second, and npm last when all are detected', async () => {
    const root = await createTemporaryDirectory();
    const fakePath = await createFakeManagerPath(root, 'pnpm');
    await createFakeExecutable(fakePath, 'bun', '1.3.0');
    await createFakeExecutable(fakePath, 'npm', '11.9.0');
    const result = await runSpawnedCli(
      [
        'ordered-app',
        '--interactive',
        '--no-install',
        '--no-setup',
        '--stack',
        'cloudflare-livekit',
      ],
      root,
      '\n\n',
      { PATH: fakePath, npm_config_user_agent: '' },
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'Which JavaScript package manager? (pnpm/bun/npm) [pnpm]',
    );
    await expect(readdir(join(root, 'ordered-app'))).resolves.toContain(
      'pnpm-lock.yaml',
    );
  });

  it('lists only detected managers and can install with explicit flags', async () => {
    const root = await createTemporaryDirectory();
    const fakePath = await createFakeManagerPath(root);
    const environment = { PATH: fakePath };
    const interactive = await runSpawnedCli(
      ['--interactive', '--stack', 'cloudflare-livekit'],
      root,
      'prompt-app\n\n\nn\n',
      environment,
    );

    expect(interactive.code).toBe(0);
    expect(interactive.stdout).toContain('(npm) [npm]');
    expect(interactive.stdout).toContain('(uv) [uv]');
    expect(interactive.stdout).not.toContain('(npm/pnpm');
    expect(interactive.stdout).not.toContain('(uv/pip');

    const installed = await runCli(
      [
        'installed-app',
        '--package-manager',
        'npm',
        '--python-package-manager',
        'uv',
        '--install',
        '--json',
      ],
      root,
      environment,
    );
    const output = JSON.parse(installed.stdout) as {
      actions: { dependenciesInstalled: boolean };
    };

    expect(installed.stderr).toBe('');
    expect(installed.stdout.trim().split('\n')).toHaveLength(1);
    expect(output.actions.dependenciesInstalled).toBe(true);
  });

  it('keeps --yes deterministic when no manager is detectable', async () => {
    const root = await createTemporaryDirectory();
    const emptyPath = join(root, 'empty-bin');
    await mkdir(emptyPath);

    const result = await runCli(['fallback-app', '--yes', '--json'], root, {
      PATH: emptyPath,
      npm_config_user_agent: 'pnpm/12.3.4',
    });
    const output = JSON.parse(result.stdout) as {
      actions: { dependenciesInstalled: boolean };
      packageManagers: { javascript: string; python: string };
    };

    expect(output.packageManagers).toEqual({
      javascript: 'pnpm',
      python: 'uv',
    });
    expect(output.actions.dependenciesInstalled).toBe(false);
    await expect(
      readFile(join(root, 'fallback-app/README.md'), 'utf8'),
    ).resolves.toContain('pnpm install');
    await expect(readdir(join(root, 'fallback-app/agent'))).resolves.toContain(
      'uv.lock',
    );
  });

  it('keeps the scaffold when an explicitly requested install fails', async () => {
    const root = await createTemporaryDirectory();
    const fakePath = join(root, 'failing-bin');
    await mkdir(fakePath);
    await createFakeExecutable(fakePath, 'npm', '11.9.0', 7);
    await createFakeExecutable(fakePath, 'uv', '0.12.9');

    const commands = await documentedSkillCommands();
    const installCommand = commands.find(
      (args) => args.includes('--install') && !args.includes('--dry-run'),
    )!;
    const result = await runSpawnedCli(
      installCommand.map((arg) =>
        arg === 'pnpm'
          ? 'npm'
          : arg === 'my-spatius-app'
            ? 'failed-install-app'
            : arg,
      ),
      root,
      undefined,
      { PATH: fakePath },
    );

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: 'INSTALL_FAILED' },
      ok: false,
      schemaVersion: 4,
    });
    await expect(
      readFile(join(root, 'failed-install-app/README.md'), 'utf8'),
    ).resolves.toContain('Spatius voice agent starter');
  });
});

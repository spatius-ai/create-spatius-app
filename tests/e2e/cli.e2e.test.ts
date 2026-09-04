import { execFile, spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = resolve('dist/cli.js');
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-spatius-app-e2e-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function runCli(
  arguments_: readonly string[],
  currentWorkingDirectory: string,
): Promise<{ stderr: string; stdout: string }> {
  return execFileAsync(process.execPath, [cliPath, ...arguments_], {
    cwd: currentWorkingDirectory,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

async function runInteractiveCli(
  answer: string,
  currentWorkingDirectory: string,
): Promise<{ stderr: string; stdout: string }> {
  const result = await runSpawnedCli(
    ['--interactive'],
    currentWorkingDirectory,
    `${answer}\n`,
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
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_], {
      cwd: currentWorkingDirectory,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
  expect(entries.sort()).toEqual([
    '.gitignore',
    'AGENTS.md',
    'README.md',
    'agent',
    'web',
    'worker',
  ]);
  await expect(readFile(join(target, 'AGENTS.md'), 'utf8')).resolves.toContain(
    'Cloudflare Worker',
  );
  await expect(
    readFile(join(target, 'web/README.md'), 'utf8'),
  ).resolves.toContain('web frontend');
  await expect(
    readFile(join(target, 'worker/README.md'), 'utf8'),
  ).resolves.toContain('Cloudflare Worker');
  await expect(
    readFile(join(target, 'agent/README.md'), 'utf8'),
  ).resolves.toContain('LiveKit agent');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe('built CLI', () => {
  it('creates a project at an explicit relative path', async () => {
    const root = await createTemporaryDirectory();

    const result = await runCli(['example-app'], root);

    expect(result.stdout).toContain('example-app');
    await expectGeneratedTree(join(root, 'example-app'));
  });

  it('uses the default project name with --yes', async () => {
    const root = await createTemporaryDirectory();

    await runCli(['--yes'], root);

    await expectGeneratedTree(join(root, 'my-spatius-app'));
  });

  it('uses the default project name when stdin is not a terminal', async () => {
    const root = await createTemporaryDirectory();

    await runCli([], root);

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

    await runCli(['existing-empty'], root);

    await expectGeneratedTree(target);
  });

  it('creates a project in the current empty directory', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'current-directory');
    await mkdir(target);

    await runCli(['.'], target);

    await expectGeneratedTree(target);
  });

  it('shows help and version information', async () => {
    const root = await createTemporaryDirectory();

    const help = await runCli(['--help'], root);
    const version = await runCli(['--version'], root);

    expect(help.stdout).toContain('Usage: create-spatius-app');
    expect(help.stdout).toContain('--yes');
    expect(help.stdout).toContain('--no-interactive');
    expect(help.stdout).toContain('--json');
    expect(help.stdout).toContain('--dry-run');
    expect(version.stdout.trim()).toBe('0.0.0');
  });

  it('emits one structured JSON document without decorative output', async () => {
    const root = await createTemporaryDirectory();

    const result = await runCli(
      ['json-app', '--no-interactive', '--json'],
      root,
    );
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(output).toMatchObject({
      command: 'create',
      dryRun: false,
      ok: true,
      schemaVersion: 1,
      template: 'default',
      wouldCreate: [],
    });
    expect(output.created).toContain('AGENTS.md');
    expect(output.created).toContain('web/README.md');
    await expectGeneratedTree(join(root, 'json-app'));
  });

  it('reports a JSON dry run without modifying the filesystem', async () => {
    const root = await createTemporaryDirectory();

    const result = await runCli(['dry-app', '--dry-run', '--json'], root);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(output).toMatchObject({
      created: [],
      dryRun: true,
      ok: true,
    });
    expect(output.wouldCreate).toContain('AGENTS.md');
    expect(output.wouldCreate).toContain('agent/README.md');
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('returns structured errors and stable exit statuses in JSON mode', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'existing');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'keep me');

    const result = await runSpawnedCli(
      ['existing', '--no-interactive', '--json'],
      root,
    );
    const output = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.code).toBe(3);
    expect(result.stderr).toBe('');
    expect(output).toMatchObject({
      error: {
        code: 'TARGET_NOT_EMPTY',
        path: target,
      },
      ok: false,
      schemaVersion: 1,
    });
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

    const result = await runSpawnedCli(['--interactive'], root);

    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Cancelled [CANCELLED]');
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('rejects a non-empty directory without changing its contents', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'existing');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'keep me');

    await expect(runCli(['existing'], root)).rejects.toMatchObject({ code: 3 });

    await expect(readdir(target)).resolves.toEqual(['keep.txt']);
    await expect(readFile(join(target, 'keep.txt'), 'utf8')).resolves.toBe(
      'keep me',
    );
  });
});

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { FailureResult, SuccessResult } from '../../src/output.js';
import { documentedSkillCommands as documentedCommands } from '../skill-fixtures.js';

const execute = promisify(execFile);
const cliPath = resolve('dist/cli.js');
const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'spatius-skill-'));
  temporaryDirectories.push(directory);
  return directory;
}

function run(arguments_: string[], cwd: string) {
  return execute(process.execPath, [cliPath, ...arguments_], {
    cwd,
    timeout: 10_000,
    env: { ...process.env, CI: '1', AI_AGENT: 'codex', NO_COLOR: '1' },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  );
});

describe('skill command examples against the built CLI', () => {
  it('discovers plain-text help and version using the documented arguments', async () => {
    const commands = await documentedCommands();
    const root = await temporaryDirectory();
    expect(
      (
        await run(
          commands.find((args) => args[0] === '--help')!,
          root,
        )
      ).stdout,
    ).toContain('--no-setup');
    expect(
      (
        await run(
          commands.find((args) => args[0] === '--version')!,
          root,
        )
      ).stdout.trim(),
    ).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it.each([
    ['pnpm', 'uv'],
    ['npm', 'pip'],
    ['bun', 'uv'],
  ])(
    'previews, creates, and safely rejects recreation with %s/%s',
    async (javascript, python) => {
      const root = await temporaryDirectory();
      const commands = await documentedCommands();
      const substitute = (args: string[]) =>
        args.map((arg) =>
          arg === 'pnpm'
            ? javascript
            : arg === 'uv'
              ? python
              : arg === 'my-spatius-app'
                ? 'app with spaces'
                : arg,
        );
      const previewArgs = substitute(
        commands.find((args) => args.includes('--dry-run'))!,
      );
      const creationArgs = substitute(
        commands.find((args) => args.includes('--no-install'))!,
      );
      const preview = JSON.parse(
        (await run(previewArgs, root)).stdout,
      ) as SuccessResult;
      expect(preview).toMatchObject({ ok: true, dryRun: true, created: [] });
      expect(await readdir(root)).toEqual([]);
      const created = JSON.parse(
        (await run(creationArgs, root)).stdout,
      ) as SuccessResult;
      expect(created).toMatchObject({
        schemaVersion: 4,
        ok: true,
        dryRun: false,
        packageManagers: { javascript, python },
        actions: {
          dependenciesInstalled: false,
          deployed: false,
          gitInitialized: false,
        },
      });
      expect(created.created).toEqual(preview.wouldCreate);
      expect(created.nextSteps).toContain(
        'npx create-spatius-app setup . --interactive',
      );
      const target = join(root, 'app with spaces');
      const before = await readFile(join(target, 'AGENTS.md'), 'utf8');
      expect(before).not.toContain('__SPATIUS_');
      const failure: unknown = await run(creationArgs, root).then(
        () => {
          throw new Error('Recreation unexpectedly succeeded');
        },
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: 3 });
      const result = JSON.parse(
        (failure as { stdout: string }).stdout,
      ) as FailureResult;
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'TARGET_NOT_EMPTY' },
      });
      expect(result.error.recovery).toBeTruthy();
      expect(await readFile(join(target, 'AGENTS.md'), 'utf8')).toBe(before);
      expect(await readdir(target)).not.toContain('.dev.vars');
      expect(await readdir(join(target, 'agent'))).not.toContain('.env.local');
    },
  );

  it('does not permit the documented setup command to authenticate in CI without a PTY', async () => {
    const commands = await documentedCommands();
    const root = await temporaryDirectory();
    await expect(
      run(
        commands.find((args) => args[0] === 'setup')!,
        root,
      ),
    ).rejects.toMatchObject({ code: 2 });
    expect(await readdir(root)).toEqual([]);
  });
});

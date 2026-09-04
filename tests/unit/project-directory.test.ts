import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertSafeTargetDirectory,
  assertTargetDirectoryAvailable,
  inspectTargetDirectory,
  normalizeTargetDirectory,
} from '../../src/project-directory.js';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'create-spatius-app-unit-'));
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

describe('project directory validation', () => {
  it('normalizes a relative path from the working directory', () => {
    expect(normalizeTargetDirectory('nested/app', '/workspace')).toBe(
      resolve('/workspace/nested/app'),
    );
  });

  it('identifies missing and empty directories', async () => {
    const parent = await createTemporaryDirectory();
    const empty = join(parent, 'empty');
    await mkdir(empty);

    await expect(inspectTargetDirectory(join(parent, 'missing'))).resolves.toBe(
      'missing',
    );
    await expect(inspectTargetDirectory(empty)).resolves.toBe(
      'empty-directory',
    );
  });

  it('rejects non-empty directories, including hidden files', async () => {
    const target = await createTemporaryDirectory();
    await writeFile(join(target, '.existing'), 'keep me');

    await expect(assertTargetDirectoryAvailable(target)).rejects.toThrow(
      'not empty',
    );
  });

  it('rejects filesystem roots and home directories', () => {
    expect(() => assertSafeTargetDirectory('/')).toThrow('filesystem root');
    expect(() =>
      assertSafeTargetDirectory('/example/home', '/example/home'),
    ).toThrow('home directory');
  });
});

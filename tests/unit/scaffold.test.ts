import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scaffoldProject } from '../../src/scaffold.js';

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

describe('scaffoldProject', () => {
  it('copies template entries and restores the .gitignore name', async () => {
    const root = await createTemporaryDirectory();
    const template = join(root, 'template');
    const target = join(root, 'project');
    await mkdir(template);
    await writeFile(join(template, 'gitignore'), 'dist/\n');
    await writeFile(join(template, 'README.md'), '# App\n');

    await scaffoldProject({
      targetDirectory: target,
      templateDirectory: template,
    });

    await expect(readFile(join(target, '.gitignore'), 'utf8')).resolves.toBe(
      'dist/\n',
    );
    await expect(readFile(join(target, 'README.md'), 'utf8')).resolves.toBe(
      '# App\n',
    );
  });

  it('rolls back a newly created target after a copy failure', async () => {
    const root = await createTemporaryDirectory();
    const template = join(root, 'template');
    const target = join(root, 'project');
    await mkdir(template);
    await writeFile(join(template, 'README.md'), '# App\n');

    await expect(
      scaffoldProject({
        copyEntry: async (_source, destination) => {
          await writeFile(destination, 'partial');
          throw new Error('simulated failure');
        },
        targetDirectory: target,
        templateDirectory: template,
      }),
    ).rejects.toThrow('simulated failure');

    await expect(readdir(root)).resolves.toEqual(['template']);
  });

  it('leaves a pre-existing empty target in place after a failure', async () => {
    const root = await createTemporaryDirectory();
    const template = join(root, 'template');
    const target = join(root, 'project');
    await mkdir(template);
    await mkdir(target);
    await writeFile(join(template, 'README.md'), '# App\n');

    await expect(
      scaffoldProject({
        copyEntry: async (_source, destination) => {
          await writeFile(destination, 'partial');
          throw new Error('simulated failure');
        },
        targetDirectory: target,
        templateDirectory: template,
      }),
    ).rejects.toThrow('simulated failure');

    await expect(readdir(target)).resolves.toEqual([]);
  });
});

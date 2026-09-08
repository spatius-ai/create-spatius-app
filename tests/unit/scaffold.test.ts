import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScaffoldPlan, scaffoldProject } from '../../src/scaffold.js';
import { resolveTemplateDirectory } from '../../src/templates.js';
import { createPackageManagers } from '../package-manager-fixtures.js';
import { createFixtureTemplate } from '../template-fixtures.js';

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
  it.each(['trailing separator', 'relative path', 'dot segments'] as const)(
    'normalizes a target with %s for planning, copying, and configuration',
    async (pathForm) => {
      const root = await createTemporaryDirectory();
      const source = join(root, 'source');
      await mkdir(source);
      await writeFile(join(source, 'file'), 'included');
      const configure = vi.fn().mockResolvedValue(undefined);
      const template = createFixtureTemplate({
        configure,
        mapFile: () => 'nested/file',
      });

      for (const state of ['missing', 'empty'] as const) {
        const target = join(root, state);
        if (state === 'empty') await mkdir(target);
        const paths = {
          'trailing separator': `${target}${sep}`,
          'relative path': relative(process.cwd(), target),
          'dot segments': `${root}${sep}.${sep}${state}${sep}..${sep}${state}`,
        };
        const options = {
          configuration: { packageManagers: createPackageManagers() },
          targetDirectory: paths[pathForm],
          templateDirectory: source,
          template,
        };
        const plan = await createScaffoldPlan(options);
        expect(plan.targetDirectory).toBe(target);
        expect(plan.files).toEqual(['nested/file']);

        const result = await scaffoldProject(options);
        expect(result).toEqual({ targetDirectory: target, files: plan.files });
        expect(configure).toHaveBeenLastCalledWith(
          target,
          options.configuration,
        );
        await expect(
          readFile(join(target, 'nested/file'), 'utf8'),
        ).resolves.toBe('included');
      }
    },
  );

  it('uses an independent adapter for inclusion, mapping, and configuration', async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, 'source');
    const target = join(root, 'target');
    await mkdir(source);
    await writeFile(join(source, 'hello.txt'), 'hello');
    await writeFile(join(source, 'ignored.txt'), 'excluded');
    const configure = vi.fn(async (directory: string) => {
      await writeFile(join(directory, 'docs/welcome.txt'), 'configured');
    });
    const template = createFixtureTemplate({
      includeFile: (path) => path !== 'ignored.txt',
      mapFile: () => 'docs/welcome.txt',
      configure,
    });
    const options = {
      configuration: { packageManagers: createPackageManagers() },
      targetDirectory: target,
      templateDirectory: source,
      template,
    };
    const plan = await createScaffoldPlan(options);
    expect(plan.files).toEqual(['docs/welcome.txt']);
    expect(configure).not.toHaveBeenCalled();
    await expect(readdir(root)).resolves.toEqual(['source']);
    const result = await scaffoldProject(options);
    expect(result.files).toEqual(plan.files);
    expect(configure).toHaveBeenCalledWith(target, options.configuration);
    await expect(
      readFile(join(target, 'docs/welcome.txt'), 'utf8'),
    ).resolves.toBe('configured');
    await expect(readFile(join(source, 'hello.txt'), 'utf8')).resolves.toBe(
      'hello',
    );
  });

  it.each([
    '../outside',
    '/outside',
    'C:\\outside',
    'nested/../outside',
    'nested//file',
    './file',
  ])('rejects unsafe mapped paths: %s', async (destination) => {
    const root = await createTemporaryDirectory();
    const source = join(root, 'source');
    await mkdir(source);
    await writeFile(join(source, 'file'), 'safe');
    await expect(
      scaffoldProject({
        targetDirectory: join(root, 'target'),
        templateDirectory: source,
        template: createFixtureTemplate({ mapFile: () => destination }),
      }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    await expect(readdir(root)).resolves.toEqual(['source']);
  });

  it.each([
    ['same', 'same'],
    ['README.md', 'readme.md'],
    ['file', 'file/nested'],
    ['file/nested', 'file'],
  ])(
    'rejects colliding mappings %s and %s before writing',
    async (first, second) => {
      const root = await createTemporaryDirectory();
      const source = join(root, 'source');
      await mkdir(source);
      await writeFile(join(source, 'a'), 'a');
      await writeFile(join(source, 'b'), 'b');
      await expect(
        scaffoldProject({
          targetDirectory: join(root, 'target'),
          templateDirectory: source,
          template: createFixtureTemplate({
            mapFile: (path) => (path === 'a' ? first : second),
          }),
        }),
      ).rejects.toThrow('collide');
      await expect(readdir(root)).resolves.toEqual(['source']);
    },
  );

  it.each([
    ['Assets/a', 'assets/b'],
    ['assets/a', 'Assets/b'],
    ['assets/Icons/a', 'assets/icons/b'],
  ])(
    'rejects inconsistent directory casing in %s and %s during planning',
    async (first, second) => {
      const root = await createTemporaryDirectory();
      const source = join(root, 'source');
      await mkdir(source);
      await writeFile(join(source, 'a'), 'a');
      await writeFile(join(source, 'b'), 'b');
      const copyEntry = vi.fn().mockResolvedValue(undefined);
      const options = {
        copyEntry,
        targetDirectory: join(root, 'target'),
        templateDirectory: source,
        template: createFixtureTemplate({
          mapFile: (path) => (path === 'a' ? first : second),
        }),
      };

      await expect(createScaffoldPlan(options)).rejects.toThrow(
        'inconsistent casing',
      );
      await expect(scaffoldProject(options)).rejects.toMatchObject({
        code: 'TEMPLATE_NOT_FOUND',
      });
      expect(copyEntry).not.toHaveBeenCalled();
      await expect(readdir(root)).resolves.toEqual(['source']);
    },
  );

  it('allows multiple files to share consistently cased mapped directories', async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, 'source');
    const target = join(root, 'target');
    await mkdir(source);
    await writeFile(join(source, 'a'), 'a');
    await writeFile(join(source, 'b'), 'b');
    const options = {
      targetDirectory: target,
      templateDirectory: source,
      template: createFixtureTemplate({
        mapFile: (path) => `Assets/Icons/${path}`,
      }),
    };
    const plan = await createScaffoldPlan(options);
    const result = await scaffoldProject(options);

    expect(result.files).toEqual(plan.files);
    expect(result.files).toEqual(['Assets/Icons/a', 'Assets/Icons/b']);
    await expect(
      readFile(join(target, 'Assets/Icons/a'), 'utf8'),
    ).resolves.toBe('a');
    await expect(
      readFile(join(target, 'Assets/Icons/b'), 'utf8'),
    ).resolves.toBe('b');
  });

  it('rejects symlink sources and omits local credentials and build artifacts', async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, 'source');
    const outside = join(root, 'outside');
    await mkdir(source);
    await mkdir(outside);
    await writeFile(join(source, 'file'), 'included');
    await writeFile(join(source, '.env.local'), 'secret');
    await writeFile(join(source, '.dev.vars'), 'secret');
    await writeFile(join(source, 'compiled.pyc'), 'ignored');
    await mkdir(join(source, 'test-results'));
    await writeFile(join(source, 'test-results/browser.txt'), 'ignored');
    await mkdir(join(source, 'playwright-report'));
    await writeFile(join(source, 'playwright-report/index.html'), 'ignored');
    const options = {
      targetDirectory: join(root, 'target'),
      templateDirectory: source,
      template: createFixtureTemplate(),
    };
    expect((await createScaffoldPlan(options)).files).toEqual(['file']);
    await symlink(
      outside,
      join(source, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(createScaffoldPlan(options)).rejects.toThrow('symbolic links');
  });

  it('rolls back nested copies when adapter configuration fails', async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, 'source');
    const target = join(root, 'target');
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, 'file'), 'included');
    await expect(
      scaffoldProject({
        configuration: { packageManagers: createPackageManagers() },
        targetDirectory: target,
        templateDirectory: source,
        template: createFixtureTemplate({
          mapFile: () => 'nested/file',
          configure: () => Promise.reject(new Error('configuration failure')),
        }),
      }),
    ).rejects.toThrow('configuration failure');
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it('plans only files for the selected package managers', async () => {
    const root = await createTemporaryDirectory();
    const npmPip = await createScaffoldPlan({
      configuration: {
        packageManagers: createPackageManagers('npm', 'pip'),
      },
      targetDirectory: join(root, 'npm-pip'),
      templateDirectory: resolveTemplateDirectory(),
    });
    const pnpmUv = await createScaffoldPlan({
      configuration: {
        packageManagers: createPackageManagers('pnpm', 'uv'),
      },
      targetDirectory: join(root, 'pnpm-uv'),
      templateDirectory: resolveTemplateDirectory(),
    });

    expect(npmPip.files).toContain('agent/Dockerfile');
    expect(npmPip.files).toContain('package-lock.json');
    expect(npmPip.files).not.toContain('agent/uv.lock');
    expect(npmPip.files).not.toContain('.npmrc');
    expect(npmPip.files).not.toContain('pnpm-lock.yaml');
    expect(npmPip.files).not.toContain('agent/Dockerfile.pip');
    expect(pnpmUv.files).toContain('agent/Dockerfile');
    expect(pnpmUv.files).toContain('agent/uv.lock');
    expect(pnpmUv.files).toContain('.npmrc');
    expect(pnpmUv.files).toContain('pnpm-lock.yaml');
    expect(pnpmUv.files).not.toContain('package-lock.json');
    expect(pnpmUv.files).not.toContain('agent/Dockerfile.uv');
  });

  it('copies and configures the bundled template', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'configured-app');

    await scaffoldProject({
      configuration: {
        packageManagers: createPackageManagers('npm', 'pip'),
      },
      targetDirectory: target,
      templateDirectory: resolveTemplateDirectory(),
    });

    await expect(
      readFile(join(target, 'README.md'), 'utf8'),
    ).resolves.toContain('npm install');
    await expect(readdir(target)).resolves.not.toContain('pnpm-lock.yaml');
    await expect(readdir(target)).resolves.toContain('package-lock.json');
  });

  it('reports missing and empty bundled templates', async () => {
    const root = await createTemporaryDirectory();
    const emptyTemplate = join(root, 'empty-template');
    await mkdir(emptyTemplate);

    await expect(
      createScaffoldPlan({
        targetDirectory: join(root, 'missing-result'),
        templateDirectory: join(root, 'missing-template'),
      }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    await expect(
      createScaffoldPlan({
        targetDirectory: join(root, 'empty-result'),
        templateDirectory: emptyTemplate,
        template: createFixtureTemplate({ layers: [] }),
      }),
    ).rejects.toThrow('template is empty');
  });

  it('copies template entries and restores reserved dotfile names', async () => {
    const root = await createTemporaryDirectory();
    const template = join(root, 'template');
    const target = join(root, 'project');
    await mkdir(template);
    await writeFile(join(template, 'gitignore'), 'dist/\n');
    await writeFile(join(template, 'npmrc'), 'save-exact=true\n');
    await writeFile(join(template, 'README.md'), '# App\n');
    await mkdir(join(template, 'agent'));
    await mkdir(join(template, 'node_modules'));
    await mkdir(join(template, 'agent/.venv'));
    await writeFile(join(template, 'agent/env.example'), 'TOKEN=\n');
    await writeFile(join(template, 'agent/dockerignore'), '.venv/\n');
    await writeFile(join(template, 'node_modules/secret.js'), 'ignored\n');
    await writeFile(join(template, 'agent/.venv/secret.py'), 'ignored\n');

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
    await expect(readFile(join(target, '.npmrc'), 'utf8')).resolves.toBe(
      'save-exact=true\n',
    );
    await expect(
      readFile(join(target, 'agent/.env.example'), 'utf8'),
    ).resolves.toBe('TOKEN=\n');
    await expect(
      readFile(join(target, 'agent/.dockerignore'), 'utf8'),
    ).resolves.toBe('.venv/\n');
    await expect(readdir(target)).resolves.not.toContain('node_modules');
    await expect(readdir(join(target, 'agent'))).resolves.not.toContain(
      '.venv',
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

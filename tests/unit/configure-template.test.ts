import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  configureGeneratedTemplate,
  toValidPackageName,
} from '../../src/templates/cloudflare-livekit/configure.js';
import { createPackageManagers } from '../package-manager-fixtures.js';

const temporaryDirectories: string[] = [];

async function createProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'spatius-configure-test-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'agent'));
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({
      name: 'placeholder',
      packageManager: 'pnpm@11.1.2',
      scripts: { build: 'vite build', check: '', deploy: '' },
    })}\n`,
  );
  await writeFile(
    join(directory, 'package-lock.json'),
    `${JSON.stringify({
      lockfileVersion: 3,
      name: 'placeholder',
      packages: { '': { name: 'placeholder' } },
    })}\n`,
  );
  const tokens = [
    '{{SPATIUS_JAVASCRIPT_PACKAGE_MANAGER}}',
    '__SPATIUS_JAVASCRIPT_INSTALL_COMMAND__',
    '__SPATIUS_PYTHON_INSTALL_COMMANDS__',
    '__SPATIUS_PYTHON_INSTALL_SUMMARY__',
    '__SPATIUS_WEB_DEV_COMMAND__',
  ].join('\n');
  await writeFile(join(directory, 'README.md'), tokens);
  await writeFile(join(directory, 'AGENTS.md'), tokens);
  await writeFile(join(directory, 'agent/README.md'), tokens);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe('generated template configuration', () => {
  it.each([
    ['pnpm', 'uv'],
    ['pnpm', 'pip'],
    ['npm', 'uv'],
    ['npm', 'pip'],
    ['bun', 'uv'],
    ['bun', 'pip'],
  ] as const)(
    'renders the onboarding documents for %s/%s',
    async (javascript, python) => {
      const project = await createProject();
      for (const path of ['README.md', 'AGENTS.md']) {
        await writeFile(
          join(project, path),
          await readFile(join('templates/cloudflare-livekit', path), 'utf8'),
        );
      }
      await configureGeneratedTemplate(project, {
        packageManagers: createPackageManagers(javascript, python),
      });
      const readme = await readFile(join(project, 'README.md'), 'utf8');
      const instructions = await readFile(join(project, 'AGENTS.md'), 'utf8');
      for (const text of [readme, instructions]) {
        expect(text).not.toMatch(/__SPATIUS_|\{\{SPATIUS_/u);
        expect(text).toContain(`${javascript} run dev`);
        expect(text).toContain('npx create-spatius-app setup . --interactive');
      }
      expect(readme).toContain(`${javascript} install`);
      expect(instructions).toContain(`${javascript} run check`);
      expect(instructions).toContain(`${javascript} run agent:check`);
      expect(readme).toContain(
        python === 'uv' ? 'uv sync' : '-m venv agent/.venv',
      );
    },
  );

  it.each(['pnpm', 'npm', 'bun'] as const)(
    'renders the unified dev and verification scripts for %s',
    async (manager) => {
      const project = await createProject();
      await configureGeneratedTemplate(project, {
        packageManagers: createPackageManagers(manager, 'uv'),
      });
      const metadata = JSON.parse(
        await readFile(join(project, 'package.json'), 'utf8'),
      ) as { scripts: Record<string, string> };
      expect(metadata.scripts.dev).toBe(
        `concurrently --kill-others --names web,agent "${manager} run dev:web" "${manager} run agent:dev"`,
      );
      expect(metadata.scripts.check).toContain(`${manager} run test:dev`);
    },
  );
  it('renders npm and pip commands and package metadata', async () => {
    const project = await createProject();

    await configureGeneratedTemplate(project, {
      packageManagers: createPackageManagers('npm', 'pip'),
      platform: 'linux',
      projectName: 'My Voice App!',
    });

    const metadata = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const readme = await readFile(join(project, 'README.md'), 'utf8');
    const packageLock = JSON.parse(
      await readFile(join(project, 'package-lock.json'), 'utf8'),
    ) as { name: string; packages: Record<string, { name: string }> };

    expect(metadata).toMatchObject({
      name: 'my-voice-app',
      packageManager: 'npm@11.9.0',
    });
    expect(metadata).not.toHaveProperty('allowScripts');
    expect(packageLock.name).toBe('my-voice-app');
    expect(packageLock.packages['']?.name).toBe('my-voice-app');
    expect(readme).toContain('npm install');
    expect(readme).toContain('python3 -m venv agent/.venv');
    expect(readme).toContain('npm run dev:web');
    expect(readme).not.toContain('__SPATIUS_');
  });

  it('allows required lifecycle scripts when npm defaults to denying them', async () => {
    const project = await createProject();
    const packageManagers = createPackageManagers('npm', 'uv');
    packageManagers.javascript.version = '12.0.2';

    await configureGeneratedTemplate(project, {
      packageManagers,
      projectName: 'npm-app',
    });

    const metadata = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      allowScripts: {
        'core-js': true,
        esbuild: true,
        workerd: true,
      },
      packageManager: 'npm@12.0.2',
    });
  });

  it('normalizes unusual target names into npm package names', () => {
    expect(toValidPackageName('  Hello, Spatius!  ')).toBe('hello-spatius');
    expect(toValidPackageName('--voice-app')).toBe('voice-app');
    expect(toValidPackageName('...')).toBe('spatius-app');
    expect(toValidPackageName(`${'a'.repeat(213)}-truncated`)).toBe(
      'a'.repeat(213),
    );
  });

  it('writes Bun trust metadata without npm-specific fields', async () => {
    const project = await createProject();

    await configureGeneratedTemplate(project, {
      packageManagers: createPackageManagers('bun', 'uv'),
      projectName: 'bun-app',
    });

    const metadata = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      packageManager: 'bun@1.3.0',
      trustedDependencies: ['core-js', 'esbuild', 'workerd'],
    });
    expect(metadata).not.toHaveProperty('allowScripts');
  });

  it('omits unknown manager versions and npm/Bun trust metadata', async () => {
    const project = await createProject();
    const packageManagers = createPackageManagers('pnpm', 'uv');
    delete packageManagers.javascript.version;

    await configureGeneratedTemplate(project, {
      packageManagers,
      projectName: 'pnpm-app',
    });

    const metadata = JSON.parse(
      await readFile(join(project, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(metadata).not.toHaveProperty('packageManager');
    expect(metadata).not.toHaveProperty('allowScripts');
    expect(metadata).not.toHaveProperty('trustedDependencies');
  });
});

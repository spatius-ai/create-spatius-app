import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  resolveProjectTemplate,
  resolveTemplateDirectory,
  templateRegistry,
} from '../../src/templates.js';
import { runCredentialSetup } from '../../src/setup/wizard.js';
import { FakePrompts } from '../setup-fixtures.js';
import { createFixtureTemplate } from '../template-fixtures.js';
import { createPackageManagers } from '../package-manager-fixtures.js';

vi.mock('../../src/setup/wizard.js', () => ({
  runCredentialSetup: vi.fn().mockResolvedValue('configured'),
}));

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('resolveTemplateDirectory', () => {
  it('resolves the template relative to the current module', () => {
    expect(basename(resolveTemplateDirectory())).toBe('cloudflare-livekit');
    expect(resolveTemplateDirectory()).toBe(
      fileURLToPath(
        new URL('../../templates/cloudflare-livekit/', import.meta.url),
      ),
    );
  });
});

describe('template registry', () => {
  it('shows only the selected dev command after install and setup complete', () => {
    const packageManagers = createPackageManagers('bun', 'uv');
    expect(
      getTemplate().nextSteps({
        credentialsConfigured: true,
        dependenciesInstalled: true,
        javascriptPackageManager: packageManagers.javascript.name,
        pythonPackageManager: packageManagers.python,
        platform: 'linux',
      }),
    ).toEqual(['bun run dev']);
  });

  it('selects the only registered default without introducing a CLI selector', () => {
    expect(Object.keys(templateRegistry)).toHaveLength(5);
    expect(getTemplate()).toBe(getTemplate(DEFAULT_TEMPLATE_ID));
    expect(getTemplate().id).toBe(DEFAULT_TEMPLATE_ID);
    expect(getTemplate().components).toHaveLength(3);
  });

  it('resolves another internal adapter from the package root', () => {
    const fixture = createFixtureTemplate({ directory: 'templates/fixture' });
    expect(resolveTemplateDirectory(fixture)).toBe(
      fileURLToPath(new URL('../../templates/fixture/', import.meta.url)),
    );
  });

  it('recognizes the previous generated layout without registry metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spatius-legacy-template-'));
    temporaryDirectories.push(root);
    await mkdir(join(root, 'agent/src'), { recursive: true });
    await mkdir(join(root, 'worker'));
    for (const path of [
      'package.json',
      'wrangler.jsonc',
      '.dev.vars.example',
      'agent/.env.example',
      'worker/index.ts',
      'agent/src/agent.py',
    ]) {
      await writeFile(join(root, path), '{}\n');
    }
    await expect(resolveProjectTemplate(root)).resolves.toBe(getTemplate());
    await rm(join(root, 'wrangler.jsonc'));
    await expect(resolveProjectTemplate(root)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      path: root,
    });
  });

  it('selects the matching adapter rather than assuming the default', async () => {
    const unrelated = createFixtureTemplate();
    const matching = createFixtureTemplate({
      id: 'matching',
      setup: {
        ...unrelated.setup,
        recognizes: (directory) => Promise.resolve(directory === '/matching'),
      },
    });
    await expect(
      resolveProjectTemplate('/matching', [unrelated, matching]),
    ).resolves.toBe(matching);
    await expect(
      resolveProjectTemplate('/unknown', [unrelated, matching]),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      resolveProjectTemplate('/matching', [
        matching,
        { ...matching, id: 'ambiguous' },
      ]),
    ).rejects.toThrow('more than one');
  });

  it('delegates setup to the existing workflow with the original options', async () => {
    const options = {
      prompts: new FakePrompts(),
      targetDirectory: '/generated',
    };
    await expect(getTemplate().setup.run(options)).resolves.toBe('configured');
    expect(runCredentialSetup).toHaveBeenCalledWith(options);
  });
});

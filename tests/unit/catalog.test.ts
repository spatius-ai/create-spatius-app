import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectCatalog, stacks, validateSelection } from '../../src/catalog.js';
import { getTemplate, resolveProjectTemplate } from '../../src/templates.js';
import { createScaffoldPlan, scaffoldProject } from '../../src/scaffold.js';
import {
  selectJavaScriptPackageManager,
  selectPythonPackageManager,
} from '../../src/package-managers.js';
import { assertSpatiusProject } from '../../src/setup/project.js';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const configuration = {
  packageManagers: {
    javascript: selectJavaScriptPackageManager(
      { javascript: [], python: [] },
      'npm',
      undefined,
    ),
    python: selectPythonPackageManager({ javascript: [], python: [] }, 'uv'),
  },
};
describe('stack catalog', () => {
  it('rejects old scenario configuration without rewriting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spatius-old-config-'));
    directories.push(directory);
    const path = join(directory, 'spatius.config.json');
    const contents = JSON.stringify({
      version: 1,
      stack: 'cloudflare-livekit',
      template: 'minimal',
    });
    await writeFile(path, contents);
    await expect(resolveProjectTemplate(directory)).rejects.toThrow(
      'Unsupported spatius.config.json version',
    );
    expect(await readFile(path, 'utf8')).toBe(contents);
  });
  it('rejects old composite identifiers', () => {
    expect(() => getTemplate('cloudflare-livekit/minimal')).toThrow(
      'Unknown template',
    );
  });
  it('keeps defaults without prompting', async () => {
    const choose = vi.fn();
    expect(
      await selectCatalog({ interactive: false, prompts: { choose } }),
    ).toEqual({ stack: 'cloudflare-livekit' });
    expect(choose).not.toHaveBeenCalled();
  });
  it('offers only the two voice AI providers', async () => {
    const messages: string[] = [];
    const result = await selectCatalog({
      interactive: true,
      prompts: {
        choose: async (message, options, initial) => {
          expect(options).toEqual([
            { value: 'cloudflare-livekit', label: 'LiveKit' },
            { value: 'cloudflare-agora', label: 'Agora Conversational AI' },
          ]);
          messages.push(message);
          return initial;
        },
      },
    });
    expect(messages).toEqual(['Which voice AI provider?']);
    expect(result.stack).toBe('cloudflare-livekit');
  });
  it.each([
    'cloudflare-livekit-railway',
    'railway-livekit-cloud',
    'railway-livekit',
    'zeabur-agora',
  ])('rejects the removed %s stack', (stack) => {
    expect(() => validateSelection(stack)).toThrow('Unsupported stack');
    expect(() => getTemplate(stack)).toThrow('Unknown template');
  });
  it('rejects unknown selections', () => {
    expect(() => validateSelection('invalid')).toThrow('Unsupported');
  });
  it('honors explicit selections without prompting', async () => {
    const choose = vi.fn();
    expect(
      await selectCatalog({
        stack: 'cloudflare-agora',
        interactive: true,
        prompts: { choose },
      }),
    ).toEqual({ stack: 'cloudflare-agora' });
    expect(choose).not.toHaveBeenCalled();
  });
  it.each(Object.keys(stacks))(
    'generates and recognizes %s with an exact dry run',
    async (stack) => {
      const directory = await mkdtemp(join(tmpdir(), 'spatius-catalog-'));
      directories.push(directory);
      const template = getTemplate(stack);
      const options = { targetDirectory: directory, configuration, template };
      const plan = await createScaffoldPlan(options);
      const result = await scaffoldProject(options);
      expect(result.files).toEqual(plan.files);
      expect(
        JSON.parse(
          await readFile(join(directory, 'spatius.config.json'), 'utf8'),
        ),
      ).toEqual({ version: 2, stack });
      expect((await resolveProjectTemplate(directory)).id).toBe(template.id);
      if (stack !== 'cloudflare-agora') await assertSpatiusProject(directory);
      expect(result.files).not.toContain('server/index.ts');
      expect(result.files).toContain('wrangler.jsonc');
      expect(result.files).toContain('.dev.vars.example');
      expect(result.files).not.toContain('Dockerfile');
      expect(result.files.some((file) => file.startsWith('agent/'))).toBe(
        stack === 'cloudflare-livekit',
      );
      expect(
        result.files.some((file) =>
          /scenario|memory|database|migrations/.test(file),
        ),
      ).toBe(false);
      expect(result.files).toContain('DEPLOYMENT.md');
      expect(result.files.some((file) => /railway|zeabur/i.test(file))).toBe(
        false,
      );
    },
  );
});

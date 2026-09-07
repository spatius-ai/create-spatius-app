import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  selectCatalog,
  stacks,
  scenarios,
  validateSelection,
} from '../../src/catalog.js';
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
describe('stack and scenario catalog', () => {
  it('keeps defaults without prompting', async () => {
    const choose = vi.fn();
    expect(
      await selectCatalog({ interactive: false, prompts: { choose } }),
    ).toEqual({ stack: 'cloudflare-livekit', template: 'minimal' });
    expect(choose).not.toHaveBeenCalled();
  });
  it('asks stack before template', async () => {
    const messages: string[] = [];
    const result = await selectCatalog({
      interactive: true,
      prompts: {
        choose: async (message, _options, initial) => {
          messages.push(message);
          return initial;
        },
      },
    });
    expect(messages).toEqual(['Which stack?', 'Which template?']);
    expect(result.template).toBe('minimal');
  });
  it('rejects unknown selections', () => {
    expect(() => validateSelection('invalid', 'minimal')).toThrow(
      'Unsupported',
    );
    expect(() => validateSelection('cloudflare-livekit', 'invalid')).toThrow(
      'Unsupported',
    );
  });
  it('honors explicit selections without prompting', async () => {
    const choose = vi.fn();
    expect(
      await selectCatalog({
        stack: 'railway-livekit',
        template: 'tutoring',
        interactive: true,
        prompts: { choose },
      }),
    ).toEqual({ stack: 'railway-livekit', template: 'tutoring' });
    expect(choose).not.toHaveBeenCalled();
  });
  it.each(
    Object.keys(stacks).flatMap((stack) =>
      Object.keys(scenarios).map((scenario) => [stack, scenario]),
    ),
  )(
    'generates and recognizes %s / %s with an exact dry run',
    async (stack, scenario) => {
      const directory = await mkdtemp(join(tmpdir(), 'spatius-catalog-'));
      directories.push(directory);
      const template = getTemplate(`${stack}/${scenario}`);
      const options = { targetDirectory: directory, configuration, template };
      const plan = await createScaffoldPlan(options);
      const result = await scaffoldProject(options);
      expect(result.files).toEqual(plan.files);
      expect(
        JSON.parse(
          await readFile(join(directory, 'spatius.config.json'), 'utf8'),
        ),
      ).toEqual({ version: 1, stack, template: scenario });
      expect((await resolveProjectTemplate(directory)).id).toBe(template.id);
      await assertSpatiusProject(directory);
      const node = stack.startsWith('railway');
      expect(result.files.includes('server/index.ts')).toBe(node);
      expect(result.files.includes('wrangler.jsonc')).toBe(!node);
      expect(result.files.includes('migrations/0001_memory.sql')).toBe(
        scenario === 'companion',
      );
      expect(result.files.includes('agent/railway.json')).toBe(
        stack.endsWith('railway') || stack === 'railway-livekit',
      );
    },
  );
});

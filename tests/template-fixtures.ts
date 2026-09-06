import type { TemplateDefinition } from '../src/templates.js';

/** An independent adapter: changing the shipped template cannot alter these tests. */
export function createFixtureTemplate(
  overrides: Partial<TemplateDefinition> = {},
): TemplateDefinition {
  return {
    id: 'fixture',
    directory: 'fixture',
    description: 'Fixture application',
    components: ['- fixture/   Fixture component'],
    includeFile: () => true,
    mapFile: (path) => path,
    configure: () => Promise.resolve(),
    createInstallPlan: () => [],
    nextSteps: () => ['fixture run'],
    setup: {
      recognizes: () => Promise.resolve(false),
      run: () => Promise.resolve('unchanged'),
    },
    verification: [],
    ...overrides,
  };
}

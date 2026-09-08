import { readProjectConfig } from './project-config.js';
import { stacks, availableScenarios, type StackId } from './catalog.js';
import { composeTemplate } from './templates/composed.js';
import { fileURLToPath } from 'node:url';

import { CliError, EXIT_CODES } from './errors.js';
import { cloudflareLivekitTemplate } from './templates/cloudflare-livekit/index.js';
import type { TemplateDefinition } from './templates/types.js';

export type {
  HumanStep,
  TemplateConfiguration,
  TemplateDefinition,
} from './templates/types.js';

export const DEFAULT_TEMPLATE_ID = 'cloudflare-livekit' as const;
export const templateRegistry: Record<string, TemplateDefinition> =
  Object.fromEntries(
    (Object.keys(stacks) as StackId[]).flatMap((stack) =>
      availableScenarios(stack).map((scenario) => {
        const template = composeTemplate(stack, scenario);
        return [template.id, template];
      }),
    ),
  );
export type TemplateId = string;
export function getTemplate(
  id: TemplateId = DEFAULT_TEMPLATE_ID,
): TemplateDefinition {
  if (id === DEFAULT_TEMPLATE_ID) return cloudflareLivekitTemplate;
  const template = templateRegistry[id];
  if (!template)
    throw new CliError('INVALID_ARGUMENT', `Unknown template: ${id}`, {
      exitCode: EXIT_CODES.invalidArgument,
    });
  return template;
}

export function resolveTemplateDirectory(
  template: TemplateDefinition = getTemplate(),
): string {
  // Both src/templates.ts and the bundled dist/templates.js / dist/cli.js
  // live exactly one directory below the installed package root.
  return fileURLToPath(new URL(`../${template.directory}/`, import.meta.url));
}

export async function resolveProjectTemplate(
  targetDirectory: string,
  templates: readonly TemplateDefinition[] = [cloudflareLivekitTemplate],
): Promise<TemplateDefinition> {
  const config = await readProjectConfig(targetDirectory);
  if (config) return getTemplate(`${config.stack}/${config.template}`);
  const matches: TemplateDefinition[] = [];
  for (const template of templates) {
    if (await template.setup.recognizes(targetDirectory))
      matches.push(template);
  }
  if (matches.length !== 1) {
    throw new CliError(
      'INVALID_ARGUMENT',
      matches.length === 0
        ? 'The target is not a compatible create-spatius-app project.'
        : 'The target matches more than one create-spatius-app template.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        path: targetDirectory,
        recovery:
          'Run this command from a generated project, or pass its directory explicitly.',
      },
    );
  }
  return matches[0]!;
}

// Internal verification entry point. These helpers are bundled for scripts
// that exercise every registry entry without adding a public CLI selector.
export { createScaffoldPlan, scaffoldProject } from './scaffold.js';
export {
  createProcessInvocation,
  selectJavaScriptPackageManager,
  selectPythonPackageManager,
} from './package-managers.js';

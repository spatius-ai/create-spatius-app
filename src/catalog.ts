import { CliError, EXIT_CODES } from './errors.js';
import type { SetupPrompts } from './prompts.js';

export const scenarios = {
  minimal: 'Minimal voice assistant',
  tutoring: 'Tutoring',
  'live-streaming': 'Live streaming',
  'customer-service': 'Customer service',
  companion: 'Companion',
} as const;
export type ScenarioId = keyof typeof scenarios;
export const stacks = {
  'cloudflare-livekit': {
    label: 'Cloudflare + LiveKit Cloud Agents',
    web: 'cloudflare',
    agent: 'livekit',
    provider: 'livekit',
  },
  'cloudflare-livekit-railway': {
    label: 'Cloudflare + LiveKit Agents on Railway',
    web: 'cloudflare',
    agent: 'railway',
    provider: 'livekit',
  },
  'railway-livekit-cloud': {
    label: 'Railway + LiveKit Cloud Agents',
    web: 'railway',
    agent: 'livekit',
    provider: 'livekit',
  },
  'railway-livekit': {
    label: 'Railway + LiveKit Agents on Railway',
    web: 'railway',
    agent: 'railway',
    provider: 'livekit',
  },
  'zeabur-agora': {
    label: 'Zeabur + Agora Conversational AI',
    web: 'zeabur',
    agent: 'agora',
    provider: 'agora',
  },
} as const;
export type StackId = keyof typeof stacks;
export const DEFAULT_STACK: StackId = 'cloudflare-livekit';
export const DEFAULT_SCENARIO: ScenarioId = 'minimal';
export function availableScenarios(_stack: StackId): ScenarioId[] {
  if (!Object.hasOwn(stacks, _stack)) return [];
  if (_stack === 'zeabur-agora') return ['minimal'];
  return Object.keys(scenarios) as ScenarioId[];
}
export function validateSelection(
  stack: string,
  template: string,
): { stack: StackId; template: ScenarioId } {
  if (
    !Object.hasOwn(stacks, stack) ||
    !Object.hasOwn(scenarios, template) ||
    !availableScenarios(stack as StackId).includes(template as ScenarioId)
  ) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Unsupported stack/template combination: ${stack} / ${template}`,
      { exitCode: EXIT_CODES.invalidArgument },
    );
  }
  return { stack: stack as StackId, template: template as ScenarioId };
}
export async function selectCatalog(options: {
  stack?: string;
  template?: string;
  interactive: boolean;
  prompts: Pick<SetupPrompts, 'choose'>;
}): Promise<{ stack: StackId; template: ScenarioId }> {
  // Validate explicit values before prompting or touching the target directory.
  if (options.stack !== undefined)
    validateSelection(options.stack, options.template ?? DEFAULT_SCENARIO);
  if (
    options.template !== undefined &&
    !Object.hasOwn(scenarios, options.template)
  )
    validateSelection(DEFAULT_STACK, options.template);
  const stackOptions = Object.entries(stacks).map(([value, stack]) => ({
    value: value as StackId,
    label: stack.label,
  }));
  const stack =
    (options.stack as StackId | undefined) ??
    (options.interactive && stackOptions.length > 1
      ? await options.prompts.choose(
          'Which stack?',
          stackOptions,
          DEFAULT_STACK,
        )
      : DEFAULT_STACK);
  const choices = availableScenarios(stack);
  const template =
    (options.template as ScenarioId | undefined) ??
    (options.interactive && choices.length > 1
      ? await options.prompts.choose(
          'Which template?',
          choices.map((value) => ({ value, label: scenarios[value] })),
          DEFAULT_SCENARIO,
        )
      : choices[0]!);
  return validateSelection(stack, template);
}

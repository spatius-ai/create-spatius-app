import { CliError, EXIT_CODES } from './errors.js';
import type { SetupPrompts } from './prompts.js';

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
export function validateSelection(stack: string): { stack: StackId } {
  if (!Object.hasOwn(stacks, stack)) {
    throw new CliError('INVALID_ARGUMENT', `Unsupported stack: ${stack}`, {
      exitCode: EXIT_CODES.invalidArgument,
    });
  }
  return { stack: stack as StackId };
}
export async function selectCatalog(options: {
  stack?: string;
  interactive: boolean;
  prompts: Pick<SetupPrompts, 'choose'>;
}): Promise<{ stack: StackId }> {
  if (options.stack !== undefined) return validateSelection(options.stack);
  const choices = Object.entries(stacks).map(([value, stack]) => ({
    value: value as StackId,
    label: stack.label,
  }));
  return validateSelection(
    options.interactive
      ? await options.prompts.choose('Which stack?', choices, DEFAULT_STACK)
      : DEFAULT_STACK,
  );
}

import { CliError, EXIT_CODES, PromptCancelledError } from './errors.js';

export const DEFAULT_PROJECT_DIRECTORY = 'my-spatius-app';

export type ProjectDirectoryPrompt = (
  initialValue: string,
) => Promise<string | symbol>;

interface ResolveProjectDirectoryOptions {
  argument?: string;
  interactive: boolean;
  prompt: ProjectDirectoryPrompt;
}

function validateInput(value: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue === '') {
    throw new CliError(
      'INVALID_ARGUMENT',
      'The project directory cannot be empty.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery: 'Provide a project directory or omit it to use the default.',
      },
    );
  }

  return trimmedValue;
}

export async function resolveProjectDirectoryInput({
  argument,
  interactive,
  prompt,
}: ResolveProjectDirectoryOptions): Promise<string> {
  if (argument !== undefined) {
    return validateInput(argument);
  }

  if (!interactive) {
    return DEFAULT_PROJECT_DIRECTORY;
  }

  const answer = await prompt(DEFAULT_PROJECT_DIRECTORY);

  if (typeof answer === 'symbol') {
    throw new PromptCancelledError();
  }

  return validateInput(answer);
}

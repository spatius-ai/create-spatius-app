export const EXIT_CODES = {
  cancelled: 130,
  filesystem: 4,
  general: 1,
  invalidArgument: 2,
  success: 0,
  targetConflict: 3,
} as const;

export type CliErrorCode =
  | 'CANCELLED'
  | 'FILESYSTEM_ERROR'
  | 'INVALID_ARGUMENT'
  | 'TARGET_NOT_DIRECTORY'
  | 'TARGET_NOT_EMPTY'
  | 'TEMPLATE_NOT_FOUND'
  | 'UNSAFE_TARGET'
  | 'UNKNOWN_ERROR';

interface CliErrorOptions {
  exitCode?: number;
  path?: string;
  recovery?: string;
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;
  readonly path?: string;
  readonly recovery?: string;

  constructor(
    code: CliErrorCode,
    message: string,
    { exitCode = EXIT_CODES.general, path, recovery }: CliErrorOptions = {},
  ) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
    this.path = path;
    this.recovery = recovery;
  }
}

export class PromptCancelledError extends CliError {
  constructor() {
    super('CANCELLED', 'Project creation was cancelled.', {
      exitCode: EXIT_CODES.cancelled,
      recovery: 'Run the command again when you are ready.',
    });
    this.name = 'PromptCancelledError';
  }
}

export function normalizeError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return new CliError('UNKNOWN_ERROR', error.message);
  }

  return new CliError(
    'UNKNOWN_ERROR',
    'An unexpected error occurred while creating the project.',
  );
}

export function formatError(error: unknown): string {
  return normalizeError(error).message;
}

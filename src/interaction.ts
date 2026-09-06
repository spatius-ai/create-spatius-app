import { CliError, EXIT_CODES } from './errors.js';

interface ResolveInteractionModeOptions {
  explicit?: boolean;
  isAgent: boolean;
  isTerminal: boolean;
  isYesMode: boolean;
  json: boolean;
  ci?: string;
}

export function isTruthyEnvironmentValue(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return !['', '0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

export type CredentialSetupDecision = 'ask' | 'run' | 'skip';

interface ResolveCredentialSetupDecisionOptions {
  ci?: string;
  command: 'create' | 'setup';
  dryRun: boolean;
  explicitlyInteractive: boolean;
  interactive: boolean;
  isAgent: boolean;
  isSecureTerminal: boolean;
  json: boolean;
  requested?: boolean;
  yes: boolean;
}

function setupRequiresTerminalError(): CliError {
  return new CliError(
    'INVALID_ARGUMENT',
    'Credential setup requires a secure interactive terminal.',
    {
      exitCode: EXIT_CODES.invalidArgument,
      recovery:
        'Allocate a PTY and run create-spatius-app setup . --interactive manually.',
    },
  );
}

export function resolveCredentialSetupDecision({
  ci,
  command,
  dryRun,
  explicitlyInteractive,
  interactive,
  isAgent,
  isSecureTerminal,
  json,
  requested,
  yes,
}: ResolveCredentialSetupDecisionOptions): CredentialSetupDecision {
  if (requested === false) {
    return 'skip';
  }

  const explicitRequest = command === 'setup' || requested === true;

  if (json || dryRun || yes || isTruthyEnvironmentValue(ci)) {
    if (explicitRequest) {
      throw new CliError(
        'INVALID_ARGUMENT',
        'Credential setup cannot run in JSON, dry-run, yes, or CI mode.',
        {
          exitCode: EXIT_CODES.invalidArgument,
          recovery:
            'Create the project first, then run create-spatius-app setup . --interactive in a terminal.',
        },
      );
    }

    return 'skip';
  }

  if (isAgent && !explicitRequest) {
    return 'skip';
  }

  if (isAgent && !explicitlyInteractive) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'Coding agents must opt in to credential setup with --interactive.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery:
          'Run create-spatius-app setup . --interactive in a PTY-enabled terminal.',
      },
    );
  }

  if (!isSecureTerminal || !interactive) {
    if (explicitRequest) {
      throw setupRequiresTerminalError();
    }

    return 'skip';
  }

  if (explicitRequest) {
    return 'run';
  }

  return command === 'create' ? 'ask' : 'run';
}

export function resolveInteractionMode({
  ci,
  explicit,
  isAgent,
  isTerminal,
  isYesMode,
  json,
}: ResolveInteractionModeOptions): boolean {
  if (explicit !== undefined) {
    return explicit;
  }

  if (isYesMode || json || isAgent || isTruthyEnvironmentValue(ci)) {
    return false;
  }

  return isTerminal;
}

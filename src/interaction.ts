interface ResolveInteractionModeOptions {
  explicit?: boolean;
  isAgent: boolean;
  isTerminal: boolean;
  isYesMode: boolean;
  json: boolean;
  ci?: string;
}

function isTruthyEnvironmentValue(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return !['', '0', 'false', 'no', 'off'].includes(value.toLowerCase());
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

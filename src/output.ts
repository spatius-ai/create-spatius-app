import type { CliError, CliErrorCode } from './errors.js';

export const OUTPUT_SCHEMA_VERSION = 1 as const;

interface ActionsResult {
  dependenciesInstalled: false;
  deployed: false;
  gitInitialized: false;
}

export interface SuccessResult {
  actions: ActionsResult;
  command: 'create';
  created: string[];
  dryRun: boolean;
  generatorVersion: string;
  nextSteps: string[];
  ok: true;
  projectDirectory: string;
  schemaVersion: typeof OUTPUT_SCHEMA_VERSION;
  template: 'default';
  wouldCreate: string[];
}

interface ErrorResultDetails {
  code: CliErrorCode;
  message: string;
  path?: string;
  recovery?: string;
}

export interface FailureResult {
  error: ErrorResultDetails;
  ok: false;
  schemaVersion: typeof OUTPUT_SCHEMA_VERSION;
}

export type CliResult = FailureResult | SuccessResult;

interface CreateSuccessResultOptions {
  dryRun: boolean;
  files: readonly string[];
  generatorVersion: string;
  projectDirectory: string;
}

export function createSuccessResult({
  dryRun,
  files,
  generatorVersion,
  projectDirectory,
}: CreateSuccessResultOptions): SuccessResult {
  return {
    actions: {
      dependenciesInstalled: false,
      deployed: false,
      gitInitialized: false,
    },
    command: 'create',
    created: dryRun ? [] : [...files],
    dryRun,
    generatorVersion,
    nextSteps: [],
    ok: true,
    projectDirectory,
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    template: 'default',
    wouldCreate: dryRun ? [...files] : [],
  };
}

export function createFailureResult(error: CliError): FailureResult {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.recovery === undefined ? {} : { recovery: error.recovery }),
    },
    ok: false,
    schemaVersion: OUTPUT_SCHEMA_VERSION,
  };
}

export function writeJsonResult(result: CliResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

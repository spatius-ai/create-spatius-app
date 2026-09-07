import type { CliError, CliErrorCode } from './errors.js';
import {
  type JavaScriptPackageManager,
  type PythonPackageManager,
  type SelectedPythonPackageManager,
} from './package-managers.js';
import {
  getTemplate,
  type HumanStep,
  type TemplateDefinition,
} from './templates.js';

export const OUTPUT_SCHEMA_VERSION = 3 as const;

interface ActionsResult {
  dependenciesInstalled: boolean;
  deployed: false;
  gitInitialized: false;
}

interface PackageManagersResult {
  javascript: JavaScriptPackageManager;
  python: PythonPackageManager;
}

export interface SuccessResult {
  actions: ActionsResult;
  command: 'create';
  created: string[];
  dryRun: boolean;
  generatorVersion: string;
  humanSteps: HumanStep[];
  nextSteps: string[];
  ok: true;
  packageManagers: PackageManagersResult;
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
  template?: TemplateDefinition;
  dryRun: boolean;
  files: readonly string[];
  generatorVersion: string;
  dependenciesInstalled: boolean;
  javascriptPackageManager: JavaScriptPackageManager;
  platform?: NodeJS.Platform;
  projectDirectory: string;
  pythonPackageManager: SelectedPythonPackageManager;
}

export function createSuccessResult({
  dryRun,
  files,
  generatorVersion,
  dependenciesInstalled,
  javascriptPackageManager,
  platform = process.platform,
  projectDirectory,
  pythonPackageManager,
  template = getTemplate(),
}: CreateSuccessResultOptions): SuccessResult {
  return {
    actions: {
      dependenciesInstalled,
      deployed: false,
      gitInitialized: false,
    },
    command: 'create',
    created: dryRun ? [] : [...files],
    dryRun,
    generatorVersion,
    humanSteps: template.humanSteps.map((step) => ({ ...step })),
    nextSteps: template.nextSteps({
      dependenciesInstalled,
      javascriptPackageManager,
      platform,
      pythonPackageManager,
    }),
    ok: true,
    packageManagers: {
      javascript: javascriptPackageManager,
      python: pythonPackageManager.name,
    },
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

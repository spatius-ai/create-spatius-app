import type { InstallStep } from '../install.js';
import type {
  JavaScriptPackageManager,
  PythonPackageManager,
  SelectedPackageManagers,
  SelectedPythonPackageManager,
} from '../package-managers.js';
import type { runCredentialSetup } from '../setup/wizard.js';

export interface TemplateConfiguration {
  packageManagers: SelectedPackageManagers;
  platform?: NodeJS.Platform;
  projectName?: string;
}

export interface TemplateNextStepsOptions {
  credentialsConfigured?: boolean;
  dependenciesInstalled: boolean;
  javascriptPackageManager: JavaScriptPackageManager;
  platform: NodeJS.Platform;
  pythonPackageManager: SelectedPythonPackageManager;
}

export interface TemplateDefinition {
  readonly id: string;
  /** Relative to the installed generator package, never the caller's cwd. */
  readonly directory: string;
  readonly description: string;
  readonly components: readonly string[];
  includeFile(path: string, configuration?: TemplateConfiguration): boolean;
  mapFile(path: string): string;
  configure(
    directory: string,
    configuration: TemplateConfiguration,
  ): Promise<void>;
  createInstallPlan(
    directory: string,
    packageManagers: SelectedPackageManagers,
    platform?: NodeJS.Platform,
  ): InstallStep[];
  nextSteps(options: TemplateNextStepsOptions): string[];
  readonly deployment: {
    run: typeof import('../deploy/wizard.js').runDeployment;
  };
  readonly setup: {
    recognizes(directory: string): Promise<boolean>;
    run: typeof runCredentialSetup;
  };
  /** Full generated-project checks, run after this template's install plan. */
  readonly verification: readonly {
    javascript: JavaScriptPackageManager;
    python: PythonPackageManager;
    scripts: readonly string[];
  }[];
}

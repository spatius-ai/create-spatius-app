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

export interface HumanStep {
  command: string;
  reason: string;
  requiresHuman: true;
  requiresTty: true;
}

export interface TemplateDefinition {
  readonly id: string;
  readonly stack?: string;
  readonly scenario?: string;
  readonly requiresPython?: boolean;
  /** Ordered bundled layers. Overrides must name exact generated paths. */
  readonly layers?: readonly {
    directory: string;
    overrides?: readonly string[];
  }[];
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
  /** Human prerequisites for machine-mode creation; commands run from the project root. */
  readonly humanSteps: readonly HumanStep[];
  nextSteps(options: TemplateNextStepsOptions): string[];
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

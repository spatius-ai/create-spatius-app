import { spawn } from 'node:child_process';

import { CliError } from './errors.js';
import {
  createProcessInvocation,
  type SelectedPackageManagers,
} from './package-managers.js';
import { getTemplate, type TemplateDefinition } from './templates.js';

export interface InstallStep {
  args: string[];
  command: string;
  cwd: string;
  displayCommand: string;
  label: string;
}

export type InstallCommandRunner = (
  step: InstallStep,
  silent: boolean,
) => Promise<void>;

function defaultInstallCommandRunner(
  step: InstallStep,
  silent: boolean,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const invocation = createProcessInvocation(step.command, step.args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: step.cwd,
      stdio: silent ? ['ignore', 'ignore', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stderr = '';

    if (silent && child.stderr !== null) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const reason =
        signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      const details = stderr.trim();
      reject(
        new Error(
          `${step.displayCommand} failed with ${reason}${details === '' ? '' : `: ${details}`}`,
        ),
      );
    });
  });
}

interface InstallProjectDependenciesOptions {
  onStep?: (step: InstallStep) => void;
  template?: TemplateDefinition;
  packageManagers: SelectedPackageManagers;
  platform?: NodeJS.Platform;
  runner?: InstallCommandRunner;
  silent?: boolean;
  targetDirectory: string;
}

export async function installProjectDependencies({
  onStep,
  packageManagers,
  platform = process.platform,
  runner = defaultInstallCommandRunner,
  silent = false,
  targetDirectory,
  template = getTemplate(),
}: InstallProjectDependenciesOptions): Promise<void> {
  const steps = template.createInstallPlan(
    targetDirectory,
    packageManagers,
    platform,
  );

  try {
    for (const step of steps) {
      onStep?.(step);
      await runner(step, silent);
    }
  } catch (error) {
    const commands = steps
      .map((step) => step.displayCommand)
      .join(' and then ');

    throw new CliError(
      'INSTALL_FAILED',
      `The project was created, but dependency installation failed: ${error instanceof Error ? error.message : 'unknown installation error'}`,
      {
        path: targetDirectory,
        recovery: `Keep the generated project and retry manually with ${commands}.`,
      },
    );
  }
}

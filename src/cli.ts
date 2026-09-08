import { selectCatalog, stacks, scenarios } from './catalog.js';
import { intro, note, outro, spinner } from '@clack/prompts';
import { determineAgent } from '@vercel/detect-agent';
import { Command, CommanderError, Option } from 'commander';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CliError,
  EXIT_CODES,
  normalizeError,
  PromptCancelledError,
} from './errors.js';
import { resolveProjectDirectoryInput } from './input.js';
import { installProjectDependencies } from './install.js';
import { formatNextSteps } from './next-steps.js';
import {
  resolveCredentialSetupDecision,
  resolveInteractionMode,
} from './interaction.js';
import {
  assertPackageManagersAvailable,
  detectPackageManagers,
  inferInvokingPackageManager,
  JAVASCRIPT_PACKAGE_MANAGERS,
  type JavaScriptPackageManager,
  PYTHON_PACKAGE_MANAGERS,
  type PythonPackageManager,
  selectJavaScriptPackageManager,
  type SelectedJavaScriptPackageManager,
  type SelectedPackageManagers,
  type SelectedPythonPackageManager,
  selectPythonPackageManager,
} from './package-managers.js';
import {
  createFailureResult,
  createSuccessResult,
  writeJsonResult,
} from './output.js';
import { normalizeTargetDirectory } from './project-directory.js';
import { Presence } from './presence.js';
import { PromptSession, type PromptOption } from './prompts.js';
import { createScaffoldPlan, scaffoldProject } from './scaffold.js';
import { SecretRedactor } from './setup/redaction.js';
import type { SpatiusRequestDiagnostic } from './setup/spatius-api.js';
import { getTemplate, resolveProjectTemplate } from './templates.js';
import { createTerminalTheme, type TerminalTheme } from './theme.js';

interface PackageMetadata {
  version: string;
}

interface CliOptions {
  stack?: string;
  template?: string;
  debug: boolean;
  dryRun: boolean;
  install?: boolean;
  interactive?: boolean;
  json: boolean;
  packageManager?: JavaScriptPackageManager;
  pythonPackageManager?: PythonPackageManager;
  setup?: boolean;
  yes: boolean;
}

interface SetupCommandOptions {
  debug?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
  json?: boolean;
  setup?: boolean;
  yes?: boolean;
}

async function readPackageVersion(): Promise<string> {
  const packagePath = fileURLToPath(
    new URL('../package.json', import.meta.url),
  );
  const contents = await readFile(packagePath, 'utf8');
  const metadata = JSON.parse(contents) as PackageMetadata;
  return metadata.version;
}

function containsBoth(
  arguments_: readonly string[],
  left: string,
  right: string,
) {
  return arguments_.includes(left) && arguments_.includes(right);
}

function validateModeOptions(options: Partial<CliOptions>): void {
  if (options.interactive === true && options.json) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--json cannot be combined with --interactive.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery: 'Remove --interactive or use human-readable output.',
      },
    );
  }

  if (options.interactive === true && options.yes) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--yes cannot be combined with --interactive.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery: 'Remove either --yes or --interactive.',
      },
    );
  }

  const arguments_ = process.argv.slice(2);
  if (containsBoth(arguments_, '--interactive', '--no-interactive')) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--interactive cannot be combined with --no-interactive.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery: 'Choose whether interactive prompts should run.',
      },
    );
  }
  if (containsBoth(arguments_, '--install', '--no-install')) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--install cannot be combined with --no-install.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery: 'Choose whether dependency installation should run.',
      },
    );
  }
  if (containsBoth(arguments_, '--setup', '--no-setup')) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--setup cannot be combined with --no-setup.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery: 'Choose whether credential setup should run.',
      },
    );
  }
  if (
    options.setup === true &&
    (options.dryRun || options.json || options.yes)
  ) {
    throw new CliError(
      'INVALID_ARGUMENT',
      '--setup cannot be combined with --dry-run, --json, or --yes.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery:
          'Create the project first, then run create-spatius-app setup . --interactive.',
      },
    );
  }
}

function commanderError(error: CommanderError): CliError {
  return new CliError(
    'INVALID_ARGUMENT',
    error.message.replace(/^error:\s*/u, ''),
    {
      exitCode: EXIT_CODES.invalidArgument,
      recovery: 'Run create-spatius-app --help to see supported options.',
    },
  );
}

function writeHumanError(error: CliError): void {
  const redactor = new SecretRedactor();
  const label = error.code === 'CANCELLED' ? 'Cancelled' : 'Error';
  const details = [
    `${label} [${error.code}]: ${redactor.redact(error.message)}`,
    ...(error.path === undefined ? [] : [`Path: ${error.path}`]),
    ...(error.recovery === undefined
      ? []
      : [`Recovery: ${redactor.redact(error.recovery)}`]),
  ];
  process.stderr.write(`${details.join('\n')}\n`);
}

function managerOptions<
  Value extends JavaScriptPackageManager | PythonPackageManager,
>(managers: Array<{ name: Value; version: string }>): PromptOption<Value>[] {
  return managers.map((manager) => ({
    ...(manager.version === 'unknown' ? {} : { hint: `v${manager.version}` }),
    label: manager.name,
    value: manager.name,
  }));
}

async function resolvePackageManagers(
  options: CliOptions,
  interactive: boolean,
  prompts: PromptSession,
): Promise<SelectedPackageManagers> {
  if (!interactive && (options.install !== true || options.dryRun)) {
    const inventory = { javascript: [], python: [] };
    const javascriptDefault =
      options.packageManager ??
      inferInvokingPackageManager(process.env.npm_config_user_agent) ??
      'npm';

    return {
      javascript: selectJavaScriptPackageManager(
        inventory,
        javascriptDefault,
        process.env.npm_config_user_agent,
      ),
      python: selectPythonPackageManager(
        inventory,
        options.pythonPackageManager ?? 'uv',
      ),
    };
  }

  const inventory = await detectPackageManagers({
    ...(options.packageManager === undefined
      ? {}
      : { javascript: [options.packageManager] }),
    ...(options.pythonPackageManager === undefined
      ? {}
      : { python: [options.pythonPackageManager] }),
  });
  const javascriptDefault =
    !interactive &&
    options.packageManager === undefined &&
    inventory.javascript.length === 0
      ? 'npm'
      : options.packageManager;
  const pythonDefault =
    !interactive &&
    options.pythonPackageManager === undefined &&
    inventory.python.length === 0
      ? 'uv'
      : options.pythonPackageManager;
  let javascript = selectJavaScriptPackageManager(
    inventory,
    javascriptDefault,
    process.env.npm_config_user_agent,
  );
  let python = selectPythonPackageManager(inventory, pythonDefault);

  if (interactive && options.packageManager === undefined) {
    const selectedName = await prompts.choose(
      'Which JavaScript package manager?',
      managerOptions(inventory.javascript),
      javascript.name,
    );
    javascript = inventory.javascript.find(
      (manager) => manager.name === selectedName,
    )!;
  }

  if (interactive && options.pythonPackageManager === undefined) {
    const selectedName = await prompts.choose(
      'Which Python package manager?',
      managerOptions(inventory.python),
      python.name,
    );
    python = inventory.python.find((manager) => manager.name === selectedName)!;
  }

  return { javascript, python };
}

function renderManagerSummary(
  javascript: SelectedJavaScriptPackageManager,
  python: SelectedPythonPackageManager,
): string {
  return `${javascript.name} + ${python.name}`;
}

function isTestTerminalOverride(): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env.CREATE_SPATIUS_APP_TEST_INTERACTIVE === '1'
  );
}

function createPromptSession(): PromptSession {
  return new PromptSession({
    allowInsecureTestInput: isTestTerminalOverride(),
    terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
  });
}

function setupPresentation(theme: TerminalTheme, debug = false) {
  return {
    onDiagnostic: debug
      ? (event: SpatiusRequestDiagnostic) => {
          process.stderr.write(`[debug] Spatius ${JSON.stringify(event)}\n`);
        }
      : undefined,
    onStatus: (message: string) => note(message, theme.accent('Setup')),
    onWarning: (message: string) => note(message, theme.highlight('Notice')),
  };
}

async function detectExecutionAgent(): Promise<boolean> {
  const agent = await determineAgent().catch(() => ({
    agent: undefined,
    isAgent: false as const,
  }));
  return agent.isAgent;
}

async function runCreateCommand(
  version: string,
  projectDirectoryArgument: string | undefined,
  rawOptions: Partial<CliOptions>,
): Promise<void> {
  const options: CliOptions = {
    stack: rawOptions.stack,
    template: rawOptions.template,
    debug: rawOptions.debug === true,
    dryRun: rawOptions.dryRun === true,
    install: rawOptions.install,
    interactive: rawOptions.interactive,
    json: rawOptions.json === true,
    packageManager: rawOptions.packageManager,
    pythonPackageManager: rawOptions.pythonPackageManager,
    setup: rawOptions.setup,
    yes: rawOptions.yes === true,
  };
  validateModeOptions(options);

  const isAgent = await detectExecutionAgent();
  const isTerminal = process.stdin.isTTY === true;
  const interactive = resolveInteractionMode({
    ci: process.env.CI,
    explicit: options.interactive,
    isAgent,
    isTerminal,
    isYesMode: options.yes,
    json: options.json,
  });
  const isSecureTerminal =
    (process.stdin.isTTY === true && process.stdout.isTTY === true) ||
    isTestTerminalOverride();
  const setupDecision = resolveCredentialSetupDecision({
    ci: process.env.CI,
    command: 'create',
    dryRun: options.dryRun,
    explicitlyInteractive: options.interactive === true,
    interactive,
    isAgent,
    isSecureTerminal,
    json: options.json,
    requested: options.setup,
    yes: options.yes,
  });
  const prompts = createPromptSession();
  const theme = createTerminalTheme();
  const presence = new Presence({ interactive, theme });

  try {
    await presence.welcome();
    if (!options.json) {
      intro(
        `${theme.accent('create-spatius-app')} ${theme.highlight(`v${version}`)}`,
      );
    }

    const selection = await selectCatalog({ ...options, interactive, prompts });
    const template = getTemplate(`${selection.stack}/${selection.template}`);
    const projectDirectoryInput = await resolveProjectDirectoryInput({
      argument: projectDirectoryArgument,
      interactive,
      prompt: async (initialValue) => prompts.projectDirectory(initialValue),
    });
    const targetDirectory = normalizeTargetDirectory(projectDirectoryInput);
    const packageManagers = await resolvePackageManagers(
      options,
      interactive,
      prompts,
    );
    const shouldInstall =
      !options.dryRun &&
      (options.install ??
        (interactive ? await prompts.shouldInstall() : false));

    if (shouldInstall) {
      assertPackageManagersAvailable(packageManagers);
    }

    const configuration = { packageManagers };
    const scaffold = options.dryRun
      ? await createScaffoldPlan({
          configuration,
          targetDirectory,
          template,
        })
      : await scaffoldProject({
          configuration,
          targetDirectory,
          template,
        });

    if (shouldInstall) {
      const usePresence = presence.animated;
      const progress = options.json
        ? undefined
        : usePresence
          ? presence
          : spinner();
      let progressStarted = false;

      try {
        await installProjectDependencies({
          onStep: (step) => {
            if (progress === undefined) return;
            if (progressStarted) {
              progress.message(step.label);
            } else {
              progress.start(step.label);
              progressStarted = true;
            }
          },
          packageManagers,
          silent: options.json || usePresence,
          targetDirectory,
          template,
        });
        progress?.stop('Dependencies installed');
      } catch (error) {
        progress?.stop('Dependency installation failed');
        throw error;
      }
    }

    let credentialsConfigured = false;
    if (!options.dryRun && setupDecision !== 'skip') {
      const shouldSetup =
        setupDecision === 'run' ||
        (setupDecision === 'ask' &&
          (await prompts.shouldConfigureCredentials()));
      if (shouldSetup) {
        try {
          const result = await template.setup.run({
            ...setupPresentation(theme, options.debug),
            prompts,
            targetDirectory,
          });
          credentialsConfigured = result === 'configured';
        } catch (error) {
          if (error instanceof PromptCancelledError) {
            note(
              'Credential setup skipped. The generated project was kept.',
              theme.highlight('Setup'),
            );
          } else {
            const setupError = normalizeError(error);
            throw new CliError(
              setupError.code,
              `The project was created, but credential setup did not complete: ${setupError.message}`,
              {
                exitCode: setupError.exitCode,
                path: targetDirectory,
                recovery:
                  'From the generated project, run npx create-spatius-app setup . --interactive.',
              },
            );
          }
        }
      }
    }

    const result = createSuccessResult({
      dependenciesInstalled: shouldInstall,
      dryRun: options.dryRun,
      files: scaffold.files,
      generatorVersion: version,
      javascriptPackageManager: packageManagers.javascript.name,
      projectDirectory: targetDirectory,
      pythonPackageManager: packageManagers.python,
      template,
    });

    if (options.json) {
      writeJsonResult(result);
      return;
    }

    note(
      (options.dryRun
        ? scaffold.files.map((file) => `- ${file}`)
        : [
            ...template.components,
            `- tooling    ${renderManagerSummary(packageManagers.javascript, packageManagers.python)}`,
            `- credentials ${credentialsConfigured ? 'configured locally' : 'not configured'}`,
          ]
      ).join('\n'),
      theme.accent(
        options.dryRun
          ? `Would create ${targetDirectory}`
          : `Created ${targetDirectory}`,
      ),
    );

    const nextSteps = template.nextSteps({
      credentialsConfigured,
      dependenciesInstalled: shouldInstall,
      javascriptPackageManager: packageManagers.javascript.name,
      platform: process.platform,
      pythonPackageManager: packageManagers.python,
    });
    outro(
      theme.highlight(
        options.dryRun
          ? 'Dry run complete. No files or dependencies were changed.'
          : 'Ready!',
      ),
    );
    if (!options.dryRun) {
      // End Clack's decoration before printing a directly copyable shell block.
      process.stdout.write(
        `Next steps:\n\n${formatNextSteps(targetDirectory, nextSteps)}\n\n`,
      );
    }
  } finally {
    presence.stop();
    prompts.close();
  }
}

async function runSetupCommand(
  version: string,
  projectDirectoryArgument: string | undefined,
  rawOptions: SetupCommandOptions,
): Promise<void> {
  if (rawOptions.setup === false) {
    throw new CliError(
      'INVALID_ARGUMENT',
      'The setup command cannot be combined with --no-setup.',
      {
        exitCode: EXIT_CODES.invalidArgument,
        recovery:
          'Omit the setup command to skip credentials, or remove --no-setup to configure them.',
      },
    );
  }
  validateModeOptions(rawOptions);

  const isAgent = await detectExecutionAgent();
  const interactive = resolveInteractionMode({
    ci: process.env.CI,
    explicit: rawOptions.interactive,
    isAgent,
    isTerminal: process.stdin.isTTY === true,
    isYesMode: rawOptions.yes === true,
    json: rawOptions.json === true,
  });
  resolveCredentialSetupDecision({
    ci: process.env.CI,
    command: 'setup',
    dryRun: rawOptions.dryRun === true,
    explicitlyInteractive: rawOptions.interactive === true,
    interactive,
    isAgent,
    isSecureTerminal:
      (process.stdin.isTTY === true && process.stdout.isTTY === true) ||
      isTestTerminalOverride(),
    json: rawOptions.json === true,
    yes: rawOptions.yes === true,
  });

  const prompts = createPromptSession();
  const theme = createTerminalTheme();
  const presence = new Presence({ interactive, theme });
  const targetDirectory = normalizeTargetDirectory(
    projectDirectoryArgument ?? '.',
  );
  try {
    await presence.welcome();
    intro(
      `${theme.accent('create-spatius-app setup')} ${theme.highlight(`v${version}`)}`,
    );
    const template = await resolveProjectTemplate(targetDirectory);
    const result = await template.setup.run({
      ...setupPresentation(theme, rawOptions.debug),
      prompts,
      targetDirectory,
    });
    outro(
      theme.highlight(
        result === 'configured'
          ? 'Local credentials configured. No cloud secrets were uploaded.'
          : 'Local credentials left unchanged.',
      ),
    );
  } finally {
    presence.stop();
    prompts.close();
  }
}

function addCreateOptions(command: Command): Command {
  return command
    .addOption(
      new Option('--stack <stack>', 'application and deployment stack').choices(
        Object.keys(stacks),
      ),
    )
    .addOption(
      new Option('--template <template>', 'application template').choices(
        Object.keys(scenarios),
      ),
    )
    .option('-y, --yes', 'accept safe defaults without prompting')
    .addOption(new Option('--interactive', 'force interactive prompts'))
    .addOption(new Option('--no-interactive', 'disable interactive prompts'))
    .addOption(
      new Option(
        '--package-manager <manager>',
        'use pnpm, bun, or npm for JavaScript dependencies',
      ).choices(JAVASCRIPT_PACKAGE_MANAGERS),
    )
    .addOption(
      new Option(
        '--python-package-manager <manager>',
        'use uv or pip for Python dependencies',
      ).choices(PYTHON_PACKAGE_MANAGERS),
    )
    .option('--install', 'install JavaScript and Python dependencies')
    .option('--no-install', 'skip dependency installation')
    .option('--setup', 'configure local LiveKit and Spatius credentials')
    .option('--no-setup', 'skip credential setup')
    .option('--debug', 'write safe Spatius request diagnostics to stderr')
    .option('--json', 'emit one machine-readable JSON result')
    .option('--dry-run', 'validate and show planned files without writing');
}

async function main(): Promise<void> {
  const version = await readPackageVersion();
  const program = addCreateOptions(
    new Command()
      .name('create-spatius-app')
      .description(getTemplate().description)
      .version(version)
      .argument(
        '[project-directory]',
        'directory in which to create the project',
      ),
  );

  program
    .addHelpText(
      'after',
      `
Examples:
  npx create-spatius-app my-app
  npx create-spatius-app my-app --package-manager pnpm --python-package-manager uv
  npx create-spatius-app my-app --no-setup
  npx create-spatius-app my-app --setup --interactive
  npx create-spatius-app setup . --interactive
  npx create-spatius-app my-app --no-interactive --no-install --json
`,
    )
    .configureOutput({ writeErr: () => undefined })
    .exitOverride()
    .action(
      async (
        projectDirectoryArgument: string | undefined,
        rawOptions: Partial<CliOptions>,
      ) => runCreateCommand(version, projectDirectoryArgument, rawOptions),
    );

  program
    .command('setup')
    .description(
      'securely configure local LiveKit and Spatius credentials for an existing generated project',
    )
    .argument('[project-directory]', 'generated project to configure', '.')
    .addOption(new Option('--interactive', 'allow browser and secret prompts'))
    .addOption(new Option('--no-interactive', 'disable interactive prompts'))
    .option('--debug', 'write safe Spatius request diagnostics to stderr')
    .addHelpText(
      'after',
      `
Examples:
  npx create-spatius-app setup
  npx create-spatius-app setup . --interactive
`,
    )
    .action(
      async (
        projectDirectoryArgument: string | undefined,
        _rawOptions: SetupCommandOptions,
        command: Command,
      ) =>
        runSetupCommand(
          version,
          projectDirectoryArgument,
          command.optsWithGlobals<SetupCommandOptions>(),
        ),
    );

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    throw error instanceof CommanderError ? commanderError(error) : error;
  }
}

const arguments_ = process.argv.slice(2);
const jsonRequested = arguments_.includes('--json');
const metadataRequested = arguments_.some((argument) =>
  ['--help', '-h', '--version', '-V'].includes(argument),
);

try {
  await main();
} catch (error) {
  const normalizedError = normalizeError(error);

  if (jsonRequested && !metadataRequested) {
    writeJsonResult(createFailureResult(normalizedError));
  } else {
    writeHumanError(normalizedError);
  }

  process.exitCode = normalizedError.exitCode;
}

import { intro, isCancel, note, outro, text } from '@clack/prompts';
import { determineAgent } from '@vercel/detect-agent';
import { Command, CommanderError, Option } from 'commander';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { CliError, EXIT_CODES, normalizeError } from './errors.js';
import { resolveProjectDirectoryInput } from './input.js';
import { resolveInteractionMode } from './interaction.js';
import {
  createFailureResult,
  createSuccessResult,
  writeJsonResult,
} from './output.js';
import { normalizeTargetDirectory } from './project-directory.js';
import { createScaffoldPlan, scaffoldProject } from './scaffold.js';
import { resolveTemplateDirectory } from './template.js';

interface PackageMetadata {
  version: string;
}

interface CliOptions {
  dryRun: boolean;
  interactive?: boolean;
  json: boolean;
  yes: boolean;
}

async function readPackageVersion(): Promise<string> {
  const packagePath = fileURLToPath(
    new URL('../package.json', import.meta.url),
  );
  const contents = await readFile(packagePath, 'utf8');
  const metadata = JSON.parse(contents) as PackageMetadata;
  return metadata.version;
}

async function promptForProjectDirectory(
  initialValue: string,
): Promise<string | symbol> {
  if (process.stdin.isTTY) {
    const answer = await text({
      defaultValue: initialValue,
      message: 'Where should we create your project?',
      placeholder: initialValue,
    });

    return isCancel(answer) ? Symbol('cancelled') : answer;
  }

  process.stdout.write(
    `Where should we create your project? (${initialValue}) `,
  );
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: process.stdin,
    terminal: false,
  });

  return new Promise((resolvePromise) => {
    let answered = false;

    lines.once('line', (answer) => {
      answered = true;
      lines.close();
      resolvePromise(answer.trim() === '' ? initialValue : answer);
    });
    lines.once('close', () => {
      if (!answered) {
        resolvePromise(Symbol('cancelled'));
      }
    });
  });
}

function validateModeOptions(options: CliOptions): void {
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
  const label = error.code === 'CANCELLED' ? 'Cancelled' : 'Error';
  const details = [
    `${label} [${error.code}]: ${error.message}`,
    ...(error.path === undefined ? [] : [`Path: ${error.path}`]),
    ...(error.recovery === undefined ? [] : [`Recovery: ${error.recovery}`]),
  ];
  process.stderr.write(`${details.join('\n')}\n`);
}

async function main(): Promise<void> {
  const version = await readPackageVersion();
  const program = new Command();

  program
    .name('create-spatius-app')
    .description(
      'Create a Spatius app with web, Cloudflare Worker, and LiveKit agent boundaries.',
    )
    .version(version)
    .argument('[project-directory]', 'directory in which to create the project')
    .option('-y, --yes', 'accept safe defaults without prompting')
    .addOption(new Option('--interactive', 'force interactive prompts'))
    .addOption(new Option('--no-interactive', 'disable interactive prompts'))
    .option('--json', 'emit one machine-readable JSON result')
    .option('--dry-run', 'validate and show planned files without writing')
    .addHelpText(
      'after',
      `
Examples:
  npx create-spatius-app my-app
  npx create-spatius-app my-app --no-interactive --json
  npx create-spatius-app my-app --dry-run
`,
    )
    .configureOutput({
      writeErr: () => undefined,
    })
    .exitOverride()
    .action(
      async (
        projectDirectoryArgument: string | undefined,
        rawOptions: Partial<CliOptions>,
      ) => {
        const options: CliOptions = {
          dryRun: rawOptions.dryRun === true,
          interactive: rawOptions.interactive,
          json: rawOptions.json === true,
          yes: rawOptions.yes === true,
        };
        validateModeOptions(options);

        const agent = await determineAgent().catch(() => ({
          agent: undefined,
          isAgent: false as const,
        }));
        const interactive = resolveInteractionMode({
          ci: process.env.CI,
          explicit: options.interactive,
          isAgent: agent.isAgent,
          isTerminal: process.stdin.isTTY === true,
          isYesMode: options.yes,
          json: options.json,
        });

        if (!options.json) {
          intro('create-spatius-app');
        }

        const projectDirectoryInput = await resolveProjectDirectoryInput({
          argument: projectDirectoryArgument,
          interactive,
          prompt: promptForProjectDirectory,
        });
        const targetDirectory = normalizeTargetDirectory(projectDirectoryInput);
        const templateDirectory = resolveTemplateDirectory();
        const scaffold = options.dryRun
          ? await createScaffoldPlan({ targetDirectory, templateDirectory })
          : await scaffoldProject({ targetDirectory, templateDirectory });
        const result = createSuccessResult({
          dryRun: options.dryRun,
          files: scaffold.files,
          generatorVersion: version,
          projectDirectory: targetDirectory,
        });

        if (options.json) {
          writeJsonResult(result);
          return;
        }

        note(
          scaffold.files.map((file) => `- ${file}`).join('\n'),
          options.dryRun
            ? `Would create ${targetDirectory}`
            : `Created ${targetDirectory}`,
        );
        outro(
          options.dryRun
            ? 'Dry run complete. No files were written.'
            : 'Your starting point is ready. More setup will be added later.',
        );
      },
    );

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return;
    }

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

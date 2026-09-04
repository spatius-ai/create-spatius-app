import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import { CliError, EXIT_CODES } from './errors.js';
import {
  assertTargetDirectoryAvailable,
  type TargetState,
} from './project-directory.js';

export type CopyEntry = (source: string, destination: string) => Promise<void>;

interface ScaffoldProjectOptions {
  copyEntry?: CopyEntry;
  targetDirectory: string;
  templateDirectory: string;
}

interface ScaffoldPlan {
  files: string[];
  targetDirectory: string;
  targetState: TargetState;
  templateDirectory: string;
  templateEntries: string[];
}

export interface ScaffoldResult {
  files: string[];
  targetDirectory: string;
}

const defaultCopyEntry: CopyEntry = async (source, destination) => {
  await cp(source, destination, {
    errorOnExist: true,
    force: false,
    recursive: true,
  });
};

function destinationName(templateEntry: string): string {
  return templateEntry === 'gitignore' ? '.gitignore' : templateEntry;
}

function destinationRelativePath(templateRelativePath: string): string {
  const [firstSegment, ...remainingSegments] = templateRelativePath.split('/');
  const renamedFirstSegment = destinationName(firstSegment ?? '');
  return [renamedFirstSegment, ...remainingSegments].join('/');
}

async function listTemplateFiles(
  templateDirectory: string,
  directory = templateDirectory,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listTemplateFiles(templateDirectory, absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      const templateRelativePath = relative(
        templateDirectory,
        absolutePath,
      ).replaceAll('\\', '/');
      files.push(destinationRelativePath(templateRelativePath));
    }
  }

  return files;
}

export async function createScaffoldPlan({
  targetDirectory,
  templateDirectory,
}: ScaffoldProjectOptions): Promise<ScaffoldPlan> {
  const targetState = await assertTargetDirectoryAvailable(targetDirectory);

  let templateEntries: string[];
  let files: string[];
  try {
    templateEntries = await readdir(templateDirectory);
    files = await listTemplateFiles(templateDirectory);
  } catch {
    throw new CliError(
      'TEMPLATE_NOT_FOUND',
      `The bundled project template could not be found at ${templateDirectory}.`,
      {
        exitCode: EXIT_CODES.filesystem,
        path: templateDirectory,
        recovery: 'Reinstall create-spatius-app and try again.',
      },
    );
  }

  if (templateEntries.length === 0 || files.length === 0) {
    throw new CliError(
      'TEMPLATE_NOT_FOUND',
      'The bundled project template is empty.',
      {
        exitCode: EXIT_CODES.filesystem,
        path: templateDirectory,
        recovery: 'Reinstall create-spatius-app and try again.',
      },
    );
  }

  return {
    files: files.sort(),
    targetDirectory,
    targetState,
    templateDirectory,
    templateEntries: templateEntries.sort(),
  };
}

async function rollback(
  targetDirectory: string,
  targetCreated: boolean,
  createdPaths: readonly string[],
): Promise<void> {
  if (targetCreated) {
    await rm(targetDirectory, { force: true, recursive: true });
    return;
  }

  await Promise.all(
    createdPaths.map(async (createdPath) => {
      await rm(createdPath, { force: true, recursive: true });
    }),
  );
}

export async function scaffoldProject({
  copyEntry = defaultCopyEntry,
  targetDirectory,
  templateDirectory,
}: ScaffoldProjectOptions): Promise<ScaffoldResult> {
  const plan = await createScaffoldPlan({
    targetDirectory,
    templateDirectory,
  });
  const createdPaths: string[] = [];
  let targetCreated = false;

  try {
    if (plan.targetState === 'missing') {
      await mkdir(dirname(targetDirectory), { recursive: true });
      await mkdir(targetDirectory);
      targetCreated = true;
    }

    for (const entry of plan.templateEntries) {
      const destination = join(targetDirectory, destinationName(entry));
      createdPaths.push(destination);
      await copyEntry(join(templateDirectory, entry), destination);
    }
  } catch (error) {
    await rollback(targetDirectory, targetCreated, createdPaths).catch(
      () => undefined,
    );

    throw new CliError(
      'FILESYSTEM_ERROR',
      `Could not create ${basename(targetDirectory)}: ${error instanceof Error ? error.message : 'unknown filesystem error'}`,
      {
        exitCode: EXIT_CODES.filesystem,
        path: targetDirectory,
        recovery: 'Check filesystem permissions and try again.',
      },
    );
  }

  return {
    files: plan.files,
    targetDirectory,
  };
}

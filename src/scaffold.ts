import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, win32 } from 'node:path';

import { CliError, EXIT_CODES } from './errors.js';
import {
  assertTargetDirectoryAvailable,
  normalizeTargetDirectory,
  type TargetState,
} from './project-directory.js';
import {
  getTemplate,
  resolveTemplateDirectory,
  type TemplateConfiguration,
  type TemplateDefinition,
} from './templates.js';

export type CopyEntry = (source: string, destination: string) => Promise<void>;

interface ScaffoldProjectOptions {
  configuration?: TemplateConfiguration;
  copyEntry?: CopyEntry;
  targetDirectory: string;
  template?: TemplateDefinition;
  /** Explicit source override for isolated fixtures. */
  templateDirectory?: string;
}

interface PlannedFile {
  destination: string;
  source: string;
}

interface ScaffoldPlan {
  entries: PlannedFile[];
  files: string[];
  targetDirectory: string;
  targetState: TargetState;
  templateDirectory: string;
}

export interface ScaffoldResult {
  files: string[];
  targetDirectory: string;
}

const defaultCopyEntry: CopyEntry = async (source, destination) => {
  await copyFile(source, destination, constants.COPYFILE_EXCL);
};

const ignoredTemplateEntries = new Set([
  '.DS_Store',
  '.npmignore',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '.wrangler',
  '__pycache__',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
  'playwright-report',
]);

function shouldIgnoreTemplateEntry(entry: string): boolean {
  return (
    ignoredTemplateEntries.has(entry) ||
    /\.py[cod]$/u.test(entry) ||
    (/^\.(?:env|dev\.vars)(?:\.|$)/u.test(entry) && !entry.endsWith('.example'))
  );
}

function assertRelativeDestination(path: string): void {
  if (
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes('\\') ||
    path.includes(':') ||
    path.includes('\0') ||
    path.split('/').some((segment) => ['', '.', '..'].includes(segment))
  ) {
    throw new Error('Template file mappings must stay inside the project.');
  }
}

async function listTemplateFiles(
  templateDirectory: string,
  template: TemplateDefinition,
  configuration: TemplateConfiguration | undefined,
  relativeDirectory = '',
): Promise<PlannedFile[]> {
  const entries = await readdir(join(templateDirectory, relativeDirectory), {
    withFileTypes: true,
  });
  const files: PlannedFile[] = [];
  for (const entry of entries) {
    if (shouldIgnoreTemplateEntry(entry.name)) continue;
    const source = [relativeDirectory, entry.name].filter(Boolean).join('/');
    if (!template.includeFile(source, configuration)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error('Bundled templates must not contain symbolic links.');
    }
    if (entry.isDirectory()) {
      files.push(
        ...(await listTemplateFiles(
          templateDirectory,
          template,
          configuration,
          source,
        )),
      );
    } else if (entry.isFile()) {
      const destination = template.mapFile(source);
      assertRelativeDestination(destination);
      files.push({ source, destination });
    } else {
      throw new Error('Bundled templates must contain regular files.');
    }
  }
  return files;
}

export async function createScaffoldPlan({
  configuration,
  targetDirectory: targetDirectoryInput,
  template = getTemplate(),
  templateDirectory = resolveTemplateDirectory(template),
}: ScaffoldProjectOptions): Promise<ScaffoldPlan> {
  const targetDirectory = normalizeTargetDirectory(targetDirectoryInput);
  const targetState = await assertTargetDirectoryAvailable(targetDirectory);

  let entries: PlannedFile[];
  try {
    const root = await lstat(templateDirectory);
    if (!root.isDirectory() || root.isSymbolicLink()) {
      throw new Error('The template must be a regular directory.');
    }
    entries = await listTemplateFiles(
      templateDirectory,
      template,
      configuration,
    );
    const destinations = new Set<string>();
    const directories = new Map<string, string>();
    for (const { destination } of entries) {
      // Reject mappings that would collide on case-insensitive filesystems too.
      const key = destination.toLowerCase();
      if (destinations.has(key) || directories.has(key)) {
        throw new Error('Template file mappings collide.');
      }
      destinations.add(key);
      const segments = destination.split('/');
      for (let index = 1; index < segments.length; index++) {
        const parent = segments.slice(0, index).join('/');
        const parentKey = parent.toLowerCase();
        if (destinations.has(parentKey))
          throw new Error('Template file mappings collide.');
        const existingParent = directories.get(parentKey);
        if (existingParent !== undefined && existingParent !== parent) {
          throw new Error(
            'Template directory mappings use inconsistent casing.',
          );
        }
        directories.set(parentKey, parent);
      }
    }
  } catch (error) {
    throw new CliError(
      'TEMPLATE_NOT_FOUND',
      'The bundled project template could not be loaded at ' +
        templateDirectory +
        ': ' +
        (error instanceof Error ? error.message : 'unknown filesystem error'),
      {
        exitCode: EXIT_CODES.filesystem,
        path: templateDirectory,
        recovery: 'Reinstall create-spatius-app and try again.',
      },
    );
  }

  if (entries.length === 0) {
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

  entries.sort((left, right) =>
    left.destination < right.destination
      ? -1
      : left.destination > right.destination
        ? 1
        : 0,
  );
  return {
    entries,
    files: entries.map((entry) => entry.destination),
    targetDirectory,
    targetState,
    templateDirectory,
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
  for (const path of [...createdPaths].reverse()) {
    await rm(path, { force: true, recursive: true });
  }
}

export async function scaffoldProject({
  configuration,
  copyEntry = defaultCopyEntry,
  targetDirectory: targetDirectoryInput,
  template = getTemplate(),
  templateDirectory = resolveTemplateDirectory(template),
}: ScaffoldProjectOptions): Promise<ScaffoldResult> {
  const plan = await createScaffoldPlan({
    configuration,
    targetDirectory: targetDirectoryInput,
    template,
    templateDirectory,
  });
  const { targetDirectory } = plan;
  const createdPaths: string[] = [];
  const createdDirectories = new Set([targetDirectory]);
  let targetCreated = false;

  async function createParent(directory: string): Promise<void> {
    if (createdDirectories.has(directory)) return;
    await createParent(dirname(directory));
    await mkdir(directory);
    createdPaths.push(directory);
    createdDirectories.add(directory);
  }

  try {
    // Recheck after planning so a destination populated during a slow read
    // is never treated as the originally empty directory.
    const targetState = await assertTargetDirectoryAvailable(targetDirectory);
    if (targetState === 'missing') {
      await mkdir(dirname(targetDirectory), { recursive: true });
      await mkdir(targetDirectory);
      targetCreated = true;
    }

    for (const entry of plan.entries) {
      const source = join(templateDirectory, entry.source);
      const destination = join(targetDirectory, entry.destination);
      const stats = await lstat(source);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('A template source is no longer a regular file.');
      }
      await createParent(dirname(destination));
      createdPaths.push(destination);
      await copyEntry(source, destination);
    }
    if (configuration !== undefined) {
      await template.configure(targetDirectory, configuration);
    }
  } catch (error) {
    await rollback(targetDirectory, targetCreated, createdPaths).catch(
      () => undefined,
    );
    throw new CliError(
      'FILESYSTEM_ERROR',
      'Could not create ' +
        basename(targetDirectory) +
        ': ' +
        (error instanceof Error ? error.message : 'unknown filesystem error'),
      {
        exitCode: EXIT_CODES.filesystem,
        path: targetDirectory,
        recovery: 'Check filesystem permissions and try again.',
      },
    );
  }
  return { files: plan.files, targetDirectory };
}

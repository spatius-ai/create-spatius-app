import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  javascriptInstallCommand,
  javascriptRunCommand,
  pythonInstallCommands,
  type SelectedPackageManagers,
} from '../../package-managers.js';
import type { TemplateConfiguration } from '../types.js';

interface PackageMetadata {
  allowScripts?: Record<string, boolean>;
  name: string;
  packageManager?: string;
  scripts: Record<string, string>;
  trustedDependencies?: string[];
}

interface PackageLockMetadata {
  name: string;
  packages?: Record<string, { name?: string }>;
}

export function toValidPackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '-')
    .replace(/^[._-]+/u, '')
    .replace(/[^a-z\d~._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .slice(0, 214)
    .replace(/-$/u, '');

  return normalized === '' ? 'spatius-app' : normalized;
}

function managerDescription(name: string, version: string | undefined): string {
  return version === undefined || version === 'unknown'
    ? name
    : `${name} ${version}`;
}

function npmRequiresScriptAllowlist(version: string | undefined): boolean {
  const major = Number.parseInt(version?.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 12;
}

function createReplacements(
  packageManagers: SelectedPackageManagers,
  platform: NodeJS.Platform,
): ReadonlyMap<string, string> {
  const javascript = packageManagers.javascript;
  const python = packageManagers.python;

  return new Map([
    [
      '{{SPATIUS_JAVASCRIPT_PACKAGE_MANAGER}}',
      managerDescription(javascript.name, javascript.version),
    ],
    [
      '{{SPATIUS_PYTHON_PACKAGE_MANAGER}}',
      managerDescription(python.name, python.version),
    ],
    [
      '__SPATIUS_JAVASCRIPT_INSTALL_COMMAND__',
      javascriptInstallCommand(javascript.name),
    ],
    [
      '__SPATIUS_PYTHON_INSTALL_COMMANDS__',
      pythonInstallCommands(python, platform).join('\n'),
    ],
    [
      '__SPATIUS_PYTHON_INSTALL_SUMMARY__',
      pythonInstallCommands(python, platform).join(' && '),
    ],
    ['__SPATIUS_DEV_COMMAND__', javascriptRunCommand(javascript.name, 'dev')],
    [
      '__SPATIUS_WEB_DEV_COMMAND__',
      javascriptRunCommand(javascript.name, 'dev:web'),
    ],
    [
      '__SPATIUS_CHECK_COMMAND__',
      javascriptRunCommand(javascript.name, 'check'),
    ],
    [
      '__SPATIUS_AGENT_CHECK_COMMAND__',
      javascriptRunCommand(javascript.name, 'agent:check'),
    ],
    [
      '__SPATIUS_AGENT_DEV_COMMAND__',
      javascriptRunCommand(javascript.name, 'agent:dev'),
    ],
    [
      '__SPATIUS_CF_TYPEGEN_COMMAND__',
      javascriptRunCommand(javascript.name, 'cf-typegen'),
    ],
    [
      '__SPATIUS_DEPLOY_COMMAND__',
      javascriptRunCommand(javascript.name, 'deploy'),
    ],
    [
      '__SPATIUS_WRANGLER_LOGIN_COMMAND__',
      javascriptRunCommand(javascript.name, 'wrangler -- login'),
    ],
    [
      '__SPATIUS_WRANGLER_API_KEY_COMMAND__',
      javascriptRunCommand(
        javascript.name,
        'wrangler -- secret put LIVEKIT_API_KEY',
      ),
    ],
    [
      '__SPATIUS_WRANGLER_API_SECRET_COMMAND__',
      javascriptRunCommand(
        javascript.name,
        'wrangler -- secret put LIVEKIT_API_SECRET',
      ),
    ],
  ]);
}

async function renderFile(
  path: string,
  replacements: ReadonlyMap<string, string>,
): Promise<void> {
  let contents = await readFile(path, 'utf8');

  for (const [token, replacement] of replacements) {
    contents = contents.replaceAll(token, replacement);
  }

  await writeFile(path, contents);
}

export async function configureGeneratedTemplate(
  targetDirectory: string,
  {
    packageManagers,
    platform = process.platform,
    projectName = basename(targetDirectory),
  }: TemplateConfiguration,
): Promise<void> {
  const packagePath = join(targetDirectory, 'package.json');
  const packageContents = await readFile(packagePath, 'utf8');
  const metadata = JSON.parse(packageContents) as PackageMetadata;
  const javascript = packageManagers.javascript;
  const run = (script: string) => javascriptRunCommand(javascript.name, script);

  metadata.name = toValidPackageName(projectName);
  if (javascript.version === undefined || javascript.version === 'unknown') {
    delete metadata.packageManager;
  } else {
    metadata.packageManager = `${javascript.name}@${javascript.version}`;
  }

  metadata.scripts.check = [
    'format:check',
    'lint',
    'typecheck',
    'test',
    'test:dev',
    'build',
  ]
    .map(run)
    .join(' && ');
  metadata.scripts.deploy = `${run('build')} && wrangler deploy`;
  metadata.scripts.dev = `node scripts/dev.mjs "${run('dev:web')}" "${run('agent:dev')}"`;

  if (
    javascript.name === 'npm' &&
    npmRequiresScriptAllowlist(javascript.version)
  ) {
    metadata.allowScripts = {
      'core-js': true,
      esbuild: true,
      workerd: true,
    };
    delete metadata.trustedDependencies;
  } else if (javascript.name === 'bun') {
    metadata.trustedDependencies = ['core-js', 'esbuild', 'workerd'];
    delete metadata.allowScripts;
  } else {
    delete metadata.allowScripts;
    delete metadata.trustedDependencies;
  }

  await writeFile(packagePath, `${JSON.stringify(metadata, undefined, 2)}\n`);

  if (javascript.name === 'npm') {
    const packageLockPath = join(targetDirectory, 'package-lock.json');
    const packageLock = JSON.parse(
      await readFile(packageLockPath, 'utf8'),
    ) as PackageLockMetadata;
    packageLock.name = metadata.name;
    if (packageLock.packages?.[''] !== undefined) {
      packageLock.packages[''].name = metadata.name;
    }
    await writeFile(
      packageLockPath,
      `${JSON.stringify(packageLock, undefined, 2)}\n`,
    );
  }

  const replacements = createReplacements(packageManagers, platform);
  // Generate once per project so registration and dispatch always agree.
  const agentReplacements = new Map([
    ['spatius-agent', `spatius-agent-${randomUUID()}`],
  ]);
  await Promise.all(
    [
      '.dev.vars.example',
      'wrangler.jsonc',
      'agent/src/agent.py',
      'agent/README.md',
      'worker/index.test.ts',
    ].map(async (relativePath) =>
      renderFile(join(targetDirectory, relativePath), agentReplacements),
    ),
  );
  await Promise.all(
    ['README.md', 'AGENTS.md', 'agent/README.md'].map(async (relativePath) =>
      renderFile(join(targetDirectory, relativePath), replacements),
    ),
  );
}

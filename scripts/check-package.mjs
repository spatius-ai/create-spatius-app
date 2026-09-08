import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  createScaffoldPlan,
  selectJavaScriptPackageManager,
  selectPythonPackageManager,
  templateRegistry,
} from '../dist/templates.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = await mkdtemp(
  join(tmpdir(), 'create-spatius-app-pack-check-'),
);

try {
  const windows = process.platform === 'win32';
  const npmCommand = windows
    ? (process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe')
    : 'npm';
  const npmArguments = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const { stdout } = await execFileAsync(
    npmCommand,
    windows ? ['/d', '/s', '/c', 'npm', ...npmArguments] : npmArguments,
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        npm_config_cache: join(temporaryRoot, 'npm-cache'),
      },
    },
  );
  const result = JSON.parse(stdout)[0];
  if (result === undefined)
    throw new Error('npm pack did not return package metadata.');

  const files = result.files.map(({ path }) => path).sort();
  const requiredFiles = new Set([
    'LICENSE',
    'README.md',
    'dist/cli.js',
    'dist/templates.js',
    'package.json',
    'schemas/result-v1.schema.json',
    'schemas/result-v2.schema.json',
    'schemas/result-v3.schema.json',
  ]);
  const inventory = { javascript: [], python: [] };
  for (const template of Object.values(templateRegistry)) {
    if (template.verification.length === 0) {
      throw new Error('No verification variants defined for ' + template.id);
    }
    for (const variant of template.verification) {
      const plan = await createScaffoldPlan({
        template,
        targetDirectory: join(
          temporaryRoot,
          template.id,
          variant.javascript + '-' + variant.python,
        ),
        configuration: {
          packageManagers: {
            javascript: selectJavaScriptPackageManager(
              inventory,
              variant.javascript,
              undefined,
            ),
            ...(variant.python
              ? {
                  python: selectPythonPackageManager(inventory, variant.python),
                }
              : {}),
          },
        },
      });
      for (const entry of plan.entries)
        requiredFiles.add(
          (entry.directory
            ? relative(repositoryRoot, entry.directory).split('\\').join('/')
            : template.directory) +
            '/' +
            entry.source,
        );
    }
  }

  for (const requiredFile of requiredFiles) {
    if (!files.includes(requiredFile))
      throw new Error('The package is missing ' + requiredFile + '.');
  }

  const forbiddenPrefixes = ['scripts/', 'src/', 'tests/', 'template/'];
  const forbiddenFile = files.find(
    (file) =>
      forbiddenPrefixes.some((prefix) => file.startsWith(prefix)) ||
      /(?:^|\/)(?:\.wrangler|\.venv|\.pytest_cache|\.ruff_cache|__pycache__|coverage|node_modules|test-results|playwright-report)(?:\/|$)/u.test(
        file,
      ) ||
      /^templates\/[^/]+\/dist\//u.test(file) ||
      /(?:^|\/)\.(?:dev\.vars|env)(?:\.|$)/u.test(file) ||
      /\.py[cod]$/u.test(file),
  );
  if (forbiddenFile !== undefined)
    throw new Error(
      'Development file leaked into the package: ' + forbiddenFile,
    );

  const packageMetadata = JSON.parse(
    await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
  );
  if (packageMetadata.bin?.['create-spatius-app'] !== './dist/cli.js') {
    throw new Error('The package does not expose the expected CLI binary.');
  }
  const cli = await readFile(join(repositoryRoot, 'dist/cli.js'), 'utf8');
  if (!cli.startsWith('#!/usr/bin/env node\n')) {
    throw new Error('The built CLI is missing its Node.js shebang.');
  }
  console.log(
    'Package contents verified (' +
      files.length +
      ' files, ' +
      Object.keys(templateRegistry).length +
      ' templates).',
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

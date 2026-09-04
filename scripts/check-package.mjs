import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const npmCache = await mkdtemp(join(tmpdir(), 'create-spatius-app-npm-'));

try {
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      env: { ...process.env, npm_config_cache: npmCache },
      shell: process.platform === 'win32',
    },
  );
  const result = JSON.parse(stdout)[0];

  if (result === undefined) {
    throw new Error('npm pack did not return package metadata.');
  }

  const files = result.files.map(({ path }) => path).sort();
  const requiredFiles = [
    'LICENSE',
    'README.md',
    'dist/cli.js',
    'package.json',
    'schemas/result-v1.schema.json',
    'template/AGENTS.md',
    'template/README.md',
    'template/agent/README.md',
    'template/gitignore',
    'template/web/README.md',
    'template/worker/README.md',
  ];

  for (const requiredFile of requiredFiles) {
    if (!files.includes(requiredFile)) {
      throw new Error(`The package is missing ${requiredFile}.`);
    }
  }

  const forbiddenPrefixes = ['scripts/', 'src/', 'tests/'];
  const forbiddenFile = files.find((file) =>
    forbiddenPrefixes.some((prefix) => file.startsWith(prefix)),
  );

  if (forbiddenFile !== undefined) {
    throw new Error(
      `Development file leaked into the package: ${forbiddenFile}`,
    );
  }

  const packageMetadata = JSON.parse(await readFile('package.json', 'utf8'));
  if (packageMetadata.bin?.['create-spatius-app'] !== './dist/cli.js') {
    throw new Error('The package does not expose the expected CLI binary.');
  }

  const cli = await readFile('dist/cli.js', 'utf8');
  if (!cli.startsWith('#!/usr/bin/env node\n')) {
    throw new Error('The built CLI is missing its Node.js shebang.');
  }

  console.log(`Package contents verified (${files.length} files).`);
} finally {
  await rm(npmCache, { force: true, recursive: true });
}

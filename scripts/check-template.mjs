import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import {
  createProcessInvocation,
  selectJavaScriptPackageManager,
  selectPythonPackageManager,
} from '../dist/templates.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: { browser: { type: 'boolean' }, stack: { type: 'string' } },
});
const browser = values.browser ?? false;
const temporaryRoot = await mkdtemp(join(tmpdir(), 'create-spatius-template-'));

async function run(command, arguments_, cwd, { quiet = false } = {}) {
  const invocation = createProcessInvocation(command, arguments_);
  try {
    const { stderr, stdout } = await execFileAsync(
      invocation.command,
      invocation.args,
      {
        cwd,
        env: { ...process.env, CI: 'true', NO_COLOR: '1' },
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (stdout && !quiet) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return stdout;
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

async function installBootstrap() {
  const packed = JSON.parse(
    await run(
      'npm',
      [
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        temporaryRoot,
      ],
      repositoryRoot,
      { quiet: true },
    ),
  );
  assert.equal(typeof packed[0]?.filename, 'string');
  const installation = join(temporaryRoot, 'bootstrap');
  await run(
    'npm',
    [
      'install',
      '--prefix',
      installation,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--offline',
      join(temporaryRoot, packed[0].filename),
    ],
    temporaryRoot,
  );
  return join(installation, 'node_modules', 'create-spatius-app');
}

async function verify(template, variant, bootstrap) {
  const name = [template.id, variant.javascript, variant.python]
    .filter(Boolean)
    .join('-');
  console.log('Verifying ' + name);
  const generatedProject = join(temporaryRoot, name);
  const inventory = { javascript: [], python: [] };
  const packageManagers = {
    javascript: selectJavaScriptPackageManager(
      inventory,
      variant.javascript,
      undefined,
    ),
    ...(variant.python
      ? { python: selectPythonPackageManager(inventory, variant.python) }
      : {}),
  };
  // Exercise the installed npm artifact's public CLI and bundled assets, from
  // outside the repository, exactly as a user generates a project.
  const generated = JSON.parse(
    await run(
      process.execPath,
      [
        join(bootstrap, 'dist', 'cli.js'),
        name,
        '--yes',
        '--no-install',
        '--no-setup',
        '--json',
        '--stack',
        template.id,
        '--package-manager',
        variant.javascript,
        ...(variant.python ? ['--python-package-manager', variant.python] : []),
      ],
      temporaryRoot,
      { quiet: true },
    ),
  );
  assert.equal(generated.ok, true);
  assert.equal(generated.stack, template.id);
  const lockPath = join(
    generatedProject,
    variant.javascript === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json',
  );
  const lockBefore = await readFile(lockPath, 'utf8');
  const typesPath = join(generatedProject, 'worker-configuration.d.ts');
  await assert.rejects(readFile(typesPath), { code: 'ENOENT' });
  const steps = template.createInstallPlan(generatedProject, packageManagers);
  for (const step of steps) {
    const args = [...step.args];
    if (step.command === 'pnpm' && args[0] === 'install')
      args.push('--frozen-lockfile');
    if (step.command === 'npm' && args[0] === 'install') args[0] = 'ci';
    if (step.command === 'uv' && args[0] === 'sync') args.push('--locked');
    await run(step.command, args, step.cwd);
  }
  assert.equal(
    await readFile(lockPath, 'utf8'),
    lockBefore,
    'Installation must not repair the generated lockfile',
  );
  // Installation creates editor types. Checks must also recover without that cache.
  const types = await readFile(typesPath, 'utf8');
  assert.match(types, /interface CloudflareBindings/);
  assert.ok(
    types.includes(variant.python ? 'LIVEKIT_API_KEY' : 'AGORA_APP_ID'),
  );
  await rm(typesPath);
  for (const script of variant.scripts) {
    await run(variant.javascript, ['run', script], generatedProject);
    if (
      browser &&
      variant.javascript === 'pnpm' &&
      variant.python === 'uv' &&
      script === 'check'
    ) {
      await run(
        'pnpm',
        [
          'exec',
          'playwright',
          'install',
          'chromium',
          ...(process.platform === 'linux' ? ['--with-deps'] : []),
        ],
        generatedProject,
      );
      await run(
        'pnpm',
        [
          'test:e2e',
          '--output',
          join(repositoryRoot, 'test-results', template.id),
        ],
        generatedProject,
      );
    }
  }
}

try {
  const bootstrap = await installBootstrap();
  const { templateRegistry } = await import(
    pathToFileURL(join(bootstrap, 'dist', 'templates.js')).href
  );
  if (values.stack && !Object.hasOwn(templateRegistry, values.stack))
    throw new Error('Unknown stack: ' + values.stack);
  const selectedTemplates = values.stack
    ? [templateRegistry[values.stack]]
    : Object.values(templateRegistry);
  for (const template of selectedTemplates) {
    if (template.verification.length === 0) {
      throw new Error('No verification variants defined for ' + template.id);
    }
    for (const variant of template.verification)
      await verify(template, variant, bootstrap);
  }
  console.log('All registered template applications verified.');
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

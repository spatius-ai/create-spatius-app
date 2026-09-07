import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import {
  createProcessInvocation,
  scaffoldProject,
  selectJavaScriptPackageManager,
  selectPythonPackageManager,
  templateRegistry,
} from '../dist/templates.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: { browser: { type: 'boolean' }, template: { type: 'string' } },
});
const browser = values.browser ?? false;
if (values.template && !Object.hasOwn(templateRegistry, values.template))
  throw new Error('Unknown template: ' + values.template);
const selectedTemplates = values.template
  ? [templateRegistry[values.template]]
  : Object.values(templateRegistry);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'create-spatius-template-'));

async function run(command, arguments_, cwd) {
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
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

async function verify(template, variant) {
  const name = template.id + '-' + variant.javascript + '-' + variant.python;
  console.log('Verifying ' + name);
  const generatedProject = join(temporaryRoot, name);
  const inventory = { javascript: [], python: [] };
  const packageManagers = {
    javascript: selectJavaScriptPackageManager(
      inventory,
      variant.javascript,
      undefined,
    ),
    python: selectPythonPackageManager(inventory, variant.python),
  };
  await scaffoldProject({
    configuration: { packageManagers },
    targetDirectory: generatedProject,
    template,
  });
  const steps = template.createInstallPlan(generatedProject, packageManagers);
  for (const step of steps) {
    const args = [...step.args];
    if (step.command === 'pnpm' && args[0] === 'install')
      args.push('--frozen-lockfile');
    if (step.command === 'uv' && args[0] === 'sync') args.push('--locked');
    await run(step.command, args, step.cwd);
  }
  for (const script of variant.scripts) {
    await run(variant.javascript, ['run', script], generatedProject);
    if (
      browser &&
      template.scenario === 'minimal' &&
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
  for (const template of selectedTemplates) {
    if (template.verification.length === 0) {
      throw new Error('No verification variants defined for ' + template.id);
    }
    for (const variant of template.verification)
      await verify(template, variant);
  }
  console.log('All registered template applications verified.');
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

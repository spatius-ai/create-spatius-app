import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectDirectory } from './agent-runtime.mjs';
import { runProcess } from './managed-process.mjs';

// A fresh directory prevents a previous run or another project from releasing
// this run's startup gate. Keep it outside the agent's auto-reload watch tree.
const directory = await mkdtemp(join(tmpdir(), 'spatius-dev-'));
try {
  const result = await runProcess(
    'concurrently',
    ['--kill-others', '--names', 'web,agent', ...process.argv.slice(2)],
    {
      cwd: projectDirectory,
      env: {
        ...process.env,
        SPATIUS_DEV_READY_FILE: join(directory, 'agent-ready'),
      },
    },
  );
  if (result.failed)
    console.error(
      'Could not start development services. Install JavaScript dependencies and try again.',
    );
  process.exitCode = result.code;
} finally {
  await rm(directory, { recursive: true, force: true });
}

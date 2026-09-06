import { join } from 'node:path';
import { projectDirectory } from './agent-runtime.mjs';
import { runProcess } from './managed-process.mjs';

const result = await runProcess(
  process.execPath,
  [
    join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js'),
    ...process.argv.slice(2),
  ],
  { cwd: projectDirectory, env: process.env },
);
if (result.failed) {
  console.error(
    'Could not launch Vite. Install JavaScript dependencies and try again.',
  );
}
process.exitCode = result.code;

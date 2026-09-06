import { join } from 'node:path';
import { projectDirectory } from './agent-runtime.mjs';
import { waitForAgent } from './wait-for-agent.mjs';
import { runProcess } from './managed-process.mjs';

try {
  if (process.env.SPATIUS_DEV_READY_FILE) {
    console.log('Waiting for the LiveKit agent to register…');
    await waitForAgent(process.env.SPATIUS_DEV_READY_FILE);
    console.log('LiveKit agent registered. Starting frontend and Worker…');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

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

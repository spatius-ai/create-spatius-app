import { runProcess } from './managed-process.mjs';
import { waitForAgent } from './wait-for-agent.mjs';
try {
  if (process.env.SPATIUS_DEV_READY_FILE) {
    console.log('Waiting for the LiveKit agent to register…');
    await waitForAgent(process.env.SPATIUS_DEV_READY_FILE);
    console.log('LiveKit agent registered. Starting frontend and API…');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const result = await runProcess(
  'concurrently',
  [
    '--kill-others',
    'vite',
    'tsx watch --env-file-if-exists=.env.local server/index.ts',
  ],
  { cwd: process.cwd(), env: process.env },
);
process.exitCode = result.code;

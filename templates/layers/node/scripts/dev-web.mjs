import { runProcess } from './managed-process.mjs';
import { waitForAgent } from './wait-for-agent.mjs';
if (process.env.SPATIUS_DEV_READY_FILE)
  await waitForAgent(process.env.SPATIUS_DEV_READY_FILE);
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

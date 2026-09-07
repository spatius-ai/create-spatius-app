import { join } from 'node:path';
import { projectDirectory } from './agent-runtime.mjs';
import { runProcess } from './managed-process.mjs';

const api = process.argv[2] === 'api';
const result = await runProcess(
  api ? 'tsx' : process.execPath,
  api
    ? ['watch', '--env-file-if-exists=.env.local', 'server/index.ts']
    : [join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js')],
  { cwd: projectDirectory, env: process.env },
);
if (result.failed) console.error('Could not start the development service.');
process.exitCode = result.code;

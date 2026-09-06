import {
  agentDirectory,
  pythonCommand,
  pythonEnvironment,
  requirePythonEnvironment,
} from './agent-runtime.mjs';
import { runProcess } from './managed-process.mjs';

try {
  requirePythonEnvironment();
  const { command, arguments_ } = pythonCommand(process.argv.slice(2));
  const result = await runProcess(command, arguments_, {
    cwd: agentDirectory,
    env: pythonEnvironment(),
  });
  if (result.failed) {
    console.error(
      'Could not launch the selected Python runtime. Follow the Python installation instructions in README.md.',
    );
  }
  process.exitCode = result.code;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

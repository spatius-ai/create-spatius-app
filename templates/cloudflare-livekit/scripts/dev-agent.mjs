import {
  agentDirectory,
  devEnvironment,
  pythonCommand,
  requirePythonEnvironment,
} from './agent-runtime.mjs';
import { runProcess } from './managed-process.mjs';
import { resolveCommand } from './command.mjs';

// v2.18.2 first passes dev credentials to Python through env rather than argv.
// https://github.com/livekit/livekit-cli/releases/tag/v2.18.2
function compatibleVersion(output) {
  const version =
    /^lk version v?(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?(?:\s|$)/m.exec(
      output.trim(),
    );
  if (!version) return false;
  const [major, minor, patch] = version.slice(1).map(Number);
  return (
    major > 2 || (major === 2 && (minor > 18 || (minor === 18 && patch >= 2)))
  );
}

async function main() {
  // Resolve before restricting Windows Python lookup: lk/uv may share a PATH
  // directory with an unrelated global python3 installation.
  const liveKitCommand = resolveCommand('lk');
  const env = devEnvironment();
  requirePythonEnvironment();
  // Neither compatibility probe needs credentials, including inherited ones.
  const probeEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^(LIVEKIT_|SPATIUS_)/i.test(key)),
  );
  const probeOptions = { cwd: agentDirectory, env: probeEnv, probe: true };
  const version = await runProcess(liveKitCommand, ['--version'], probeOptions);
  if (version.interrupted) return version.code;
  let useLiveKit =
    !version.failed && version.code === 0 && compatibleVersion(version.output);
  if (useLiveKit) {
    const help = await runProcess(
      liveKitCommand,
      ['agent', 'dev', '--help'],
      probeOptions,
    );
    if (help.interrupted) return help.code;
    useLiveKit =
      !help.failed &&
      help.code === 0 &&
      /lk agent dev\b/.test(help.output) &&
      /entrypoint/.test(help.output);
  }

  const { command, arguments_ } = useLiveKit
    ? { command: liveKitCommand, arguments_: ['agent', 'dev', 'src/agent.py'] }
    : pythonCommand(['-m', 'livekit.agents', 'start', 'src/agent.py', '--dev']);
  if (!useLiveKit) {
    console.error(
      'A compatible LiveKit CLI (>=2.18.2) was not found. Starting the selected Python runtime in dev mode without CLI auto-reload.',
    );
  }
  const result = await runProcess(command, arguments_, {
    cwd: agentDirectory,
    env,
  });
  if (result.failed)
    console.error(
      'Could not launch the selected agent runtime. Check its installation and try again.',
    );
  return result.code;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

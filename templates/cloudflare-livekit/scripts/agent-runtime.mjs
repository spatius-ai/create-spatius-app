import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { resolveCommand } from './command.mjs';

export const projectDirectory = resolve(import.meta.dirname, '..');
export const agentDirectory = join(projectDirectory, 'agent');
export const usesUv = existsSync(join(agentDirectory, 'uv.lock'));
const virtualEnvironment = join(agentDirectory, '.venv');
const virtualBin = join(
  virtualEnvironment,
  process.platform === 'win32' ? 'Scripts' : 'bin',
);
export const python = join(
  virtualBin,
  process.platform === 'win32' ? 'python.exe' : 'python',
);

export function pythonEnvironment(environment = process.env) {
  // lk's pip launcher resolves Python through PATH. Pin both launch paths to
  // this project's environment, even when another environment is activated.
  const env = { ...environment };
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  let inheritedPath = env[pathKey] ?? '';
  if (process.platform === 'win32') {
    // lk checks python3 before python and only recognizes POSIX venv paths.
    // Exclude other python3 installations so its pip path finds our python.exe.
    inheritedPath = inheritedPath
      .split(delimiter)
      .filter(
        (directory) =>
          !['.exe', '.com', '.cmd', '.bat'].some((suffix) =>
            existsSync(join(directory, `python3${suffix}`)),
          ),
      )
      .join(delimiter);
  }
  env[pathKey] = `${virtualBin}${delimiter}${inheritedPath}`;
  env.VIRTUAL_ENV = virtualEnvironment;
  env.UV_PROJECT_ENVIRONMENT = virtualEnvironment;
  env.UV_PYTHON = python;
  env.UV_NO_SYNC = '1';
  env.UV_PYTHON_DOWNLOADS = 'never';
  env.UV_OFFLINE = '1';
  env.UV_NO_ENV_FILE = '1';
  return env;
}

export function requirePythonEnvironment() {
  if (!existsSync(python)) {
    throw new Error(
      'Python dependencies are not installed in agent/.venv. Follow the Python installation instructions in README.md, then try again.',
    );
  }
}

export function pythonCommand(arguments_) {
  return usesUv
    ? {
        command: resolveCommand('uv'),
        arguments_: [
          'run',
          '--no-sync',
          '--directory',
          agentDirectory,
          '--extra',
          'dev',
          'python',
          ...arguments_,
        ],
      }
    : { command: python, arguments_ };
}

export function devEnvironment() {
  let local = {};
  try {
    local = parseEnv(readFileSync(join(agentDirectory, '.env.local'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(
        'Could not read agent/.env.local. Check its contents and permissions.',
        { cause: error },
      );
    }
  }

  // Explicit inherited values, including empty values, take precedence.
  const env = { ...local, ...process.env };
  const required = [
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'SPATIUS_API_KEY',
    'SPATIUS_APP_ID',
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing agent development credentials: ${missing.join(', ')}. Set them in agent/.env.local or the environment. See README.md for credential setup.`,
    );
  }
  const placeholders = required.filter((key) =>
    /^(?:your[-_]|<)|your-project\.livekit\.cloud/i.test(env[key].trim()),
  );
  if (placeholders.length) {
    throw new Error(
      `Replace example values for ${placeholders.join(', ')} in agent/.env.local or the environment. See README.md for credential setup.`,
    );
  }
  let validUrl = false;
  try {
    const url = new URL(env.LIVEKIT_URL);
    validUrl =
      ['https:', 'wss:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    /* Report only the variable name, never the supplied value. */
  }
  if (!validUrl) {
    throw new Error(
      'LIVEKIT_URL must be a valid https:// or wss:// server URL without embedded credentials. Set it in agent/.env.local or the environment. See README.md for credential setup.',
    );
  }
  return pythonEnvironment(env);
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

export const templateDirectory = resolve(import.meta.dirname, '..');
export const windows = process.platform === 'win32';
export const credentials = {
  LIVEKIT_URL: 'wss://dev-test.livekit.cloud',
  LIVEKIT_API_KEY: 'dev-test-api-key',
  LIVEKIT_API_SECRET: 'dev-test-secret # with spaces',
  SPATIUS_API_KEY: 'dev-test-spatius-key',
  SPATIUS_APP_ID: 'dev-test-app-id',
};

const fakeRuntime = `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const role = process.argv[2];
const args = process.argv.slice(3);
const selected = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(LIVEKIT_|SPATIUS_|UV_|VIRTUAL_ENV$|PATH$)/i.test(key)));
const event = (type, extra = {}) => appendFileSync(process.env.DEV_TEST_EVENTS, JSON.stringify({ type, role, pid: process.pid, cwd: process.cwd(), args, env: selected, ...extra }) + '\\n');
event('invoked');
const hold = () => {
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    event('stopped', { signal });
    if (process.env.DEV_TEST_IGNORE_SIGNALS !== '1') process.exit(0);
  });
  setInterval(() => {}, 1000);
};
const ready = () => { event('ready'); };
const spawnGrandchild = () => spawn(process.execPath, [process.argv[1], 'grandchild'], {
  env: process.env, stdio: 'inherit',
  detached: process.env.DEV_TEST_DETACHED === '1' && process.platform !== 'win32',
});
if (role === 'lk' && args[0] === '--version') {
  if (process.env.DEV_TEST_PROBE === 'version-hang') {
    if (process.env.DEV_TEST_PROBE_GRANDCHILD === '1') spawnGrandchild();
    hold(); ready();
  }
  else if (process.env.DEV_TEST_PROBE === 'flood') process.stdout.write('private-probe-output'.repeat(10000));
  else { console.log(process.env.DEV_TEST_VERSION ?? 'lk version 2.18.2'); process.exit(Number(process.env.DEV_TEST_VERSION_EXIT ?? 0)); }
} else if (role === 'lk' && args.includes('--help')) {
  if (process.env.DEV_TEST_PROBE === 'help-hang') { hold(); ready(); }
  else { console.log(process.env.DEV_TEST_HELP ?? 'NAME: lk agent dev\\nUSAGE: lk agent dev [entrypoint]'); process.exit(Number(process.env.DEV_TEST_HELP_EXIT ?? 0)); }
} else if (role === 'grandchild' || role === 'api') {
  hold(); ready();
} else {
  if (role !== 'web' && process.env.SPATIUS_DEV_READY_FILE && process.env.DEV_TEST_RUNTIME_HOLD === '1') {
    const register = () => {
      event('registered');
      writeFileSync(process.env.SPATIUS_DEV_READY_FILE, '');
    };
    if (process.env.DEV_TEST_REGISTER) {
      const poll = setInterval(() => {
        if (existsSync(process.env.DEV_TEST_REGISTER)) { clearInterval(poll); register(); }
      }, 20);
    } else register();
  }
  if (process.env.DEV_TEST_GRANDCHILD === '1') {
    spawnGrandchild();
  }
  if (role === 'web') {
    hold(); ready();
    if (process.env.DEV_TEST_WEB_EXIT) {
      const poll = setInterval(() => {
        if (existsSync(process.env.DEV_TEST_RELEASE)) {
          clearInterval(poll);
          process.exit(Number(process.env.DEV_TEST_WEB_EXIT));
        }
      }, 20);
    }
  } else if (process.env.DEV_TEST_RUNTIME_HOLD === '1') {
    hold(); ready();
    if (process.env.DEV_TEST_EXIT_WHEN_RELEASED === '1') {
      setInterval(() => {
        if (existsSync(process.env.DEV_TEST_RELEASE)) process.exit(Number(process.env.DEV_TEST_RUNTIME_EXIT ?? 0));
      }, 20);
    }
  } else process.exit(Number(process.env.DEV_TEST_RUNTIME_EXIT ?? 0));
}
`;

export async function fixture(
  t,
  { uv = false, lk = true, local = credentials, python = true } = {},
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'spatius dev test ')),
  );
  const scripts = join(root, 'scripts');
  const agent = join(root, 'agent');
  const bin = join(root, 'fake tools');
  const virtualBin = join(agent, '.venv', windows ? 'Scripts' : 'bin');
  const events = join(root, 'events.jsonl');
  const runtime = join(root, 'fake-runtime.mjs');
  await Promise.all([
    mkdir(bin, { recursive: true }),
    mkdir(virtualBin, { recursive: true }),
    cp(join(templateDirectory, 'scripts'), scripts, { recursive: true }),
  ]);
  await writeFile(runtime, fakeRuntime);
  await writeFile(events, '');
  if (local)
    await writeFile(
      join(agent, '.env.local'),
      Object.entries(local)
        .map(([key, value]) => `${key}='${value}'`)
        .join('\n'),
    );
  if (uv) await writeFile(join(agent, 'uv.lock'), '# selected uv\n');

  const executable = async (name, directory = bin, role = name) => {
    const path = join(directory, windows ? `${name}.cmd` : name);
    const body = windows
      ? `@echo off\r\n"${process.execPath}" "${runtime}" ${role} %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${runtime.replaceAll("'", "'\\''")}' ${role} "$@"\n`;
    await writeFile(path, body, { mode: 0o755 });
    return path;
  };
  await executable('tsx', bin, 'api');
  if (lk) await executable('lk');
  if (uv) await executable('uv');
  if (python) {
    if (windows)
      await writeFile(join(virtualBin, 'python.exe'), 'preflight-only stub');
    else await executable('python', virtualBin);
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(LIVEKIT_|SPATIUS_|UV_|PYTHON|VIRTUAL_ENV$|PATH$|NODE_OPTIONS$)/i.test(
          key,
        ),
    ),
  );
  env.PATH = [
    bin,
    dirname(process.execPath),
    ...(windows
      ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')]
      : []),
  ].join(delimiter);
  env.DEV_TEST_EVENTS = events;
  env.DEV_TEST_RELEASE = join(root, 'release');
  env.NO_COLOR = '1';
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
    }
    for (const event of await readEvents(events)) {
      if (event.pid && event.pid !== process.pid) {
        try {
          process.kill(event.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
    }
    await rm(root, { recursive: true, force: true });
  });
  const start = (script = 'dev-agent.mjs', extraEnv = {}, args = []) => {
    const child = spawn(process.execPath, [join(scripts, script), ...args], {
      cwd: tmpdir(),
      env: { ...env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal, output }));
    });
    return { child, done };
  };
  return {
    root,
    agent,
    virtualBin,
    bin,
    events,
    env,
    runtime,
    executable,
    start,
    children,
  };
}

export async function readEvents(path) {
  // A concurrent append can be visible before its terminating newline.
  // Parse only complete records; the next poll will read the finished tail.
  const contents = await readFile(path, 'utf8');
  return contents
    .slice(0, contents.lastIndexOf('\n') + 1)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function waitForEvents(path, predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const events = await readEvents(path);
    if (predicate(events)) return events;
    await delay(25);
  }
  assert.fail('Timed out waiting for fake processes to become ready.');
}

export async function assertStopped(pids) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const alive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (!alive.length) return;
    await delay(25);
  }
  assert.fail('A fake runtime or descendant survived teardown.');
}

export function assertNoCredentials(output) {
  for (const value of Object.values(credentials))
    assert.ok(!output.includes(value), 'Credential value leaked into output.');
}

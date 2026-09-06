import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { commandSpec } from '../scripts/command.mjs';
import {
  assertNoCredentials,
  assertStopped,
  fixture,
  templateDirectory,
  readEvents,
  waitForEvents,
  windows,
} from './dev-fixtures.mjs';

// Resolves in generated projects and in the root CI installation. A missing
// dependency fails this suite rather than silently skipping supervision tests.
const require = createRequire(import.meta.url);
const concurrentlyPackage = require.resolve('concurrently/package.json');
const concurrentlyBin = join(
  dirname(concurrentlyPackage),
  require(concurrentlyPackage).bin.concurrently,
);

async function supervise(f, extraEnv) {
  const viteBin = join(f.root, 'node_modules', 'vite', 'bin');
  await mkdir(viteBin, { recursive: true });
  await writeFile(
    join(viteBin, 'vite.js'),
    `process.argv = [process.argv[0], ${JSON.stringify(f.runtime)}, 'web']; await import(${JSON.stringify(pathToFileURL(f.runtime).href)});`,
  );
  const sourcePackage = JSON.parse(
    await readFile(join(templateDirectory, 'package.json'), 'utf8'),
  );
  // Exercise the production script composition with npm, available alongside
  // Node in both generated projects and root CI. Only PM selection changes.
  const scripts = Object.fromEntries(
    ['dev', 'dev:web', 'agent:dev'].map((name) => [
      name,
      sourcePackage.scripts[name].replaceAll('pnpm run ', 'npm run '),
    ]),
  );
  await writeFile(
    join(f.root, 'package.json'),
    JSON.stringify({
      name: 'dev-supervision-fixture',
      private: true,
      type: 'module',
      scripts,
    }),
  );
  const localBin = join(f.root, 'node_modules', '.bin');
  await mkdir(localBin, { recursive: true });
  await writeFile(
    join(localBin, windows ? 'concurrently.cmd' : 'concurrently'),
    windows
      ? `@echo off\r\n"${process.execPath}" "${concurrentlyBin}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${concurrentlyBin.replaceAll("'", "'\\''")}' "$@"\n`,
    { mode: 0o755 },
  );
  await writeFile(
    join(localBin, windows ? 'vite.cmd' : 'vite'),
    windows
      ? `@echo off\r\n"${process.execPath}" "${join(viteBin, 'vite.js')}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${join(viteBin, 'vite.js').replaceAll("'", "'\\''")}' "$@"\n`,
    { mode: 0o755 },
  );
  const env = { ...f.env, ...extraEnv };
  env.PATH += `${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
  const spec = commandSpec('npm', ['run', 'dev'], env);
  const child = spawn(spec.command, spec.arguments_, {
    cwd: f.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !windows,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  });
  f.children.push(child);
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
}

for (const [name, side, code] of [
  ['web exits zero', 'web', '0'],
  ['web fails', 'web', '7'],
  ['agent exits zero', 'agent', '0'],
  ['agent fails', 'agent', '29'],
]) {
  test(
    `real concurrently: ${name} stops its sibling and all grandchildren`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t);
      const run = await supervise(f, {
        DEV_TEST_RUNTIME_HOLD: '1',
        DEV_TEST_GRANDCHILD: '1',
        ...(side === 'web'
          ? { DEV_TEST_WEB_EXIT: code }
          : { DEV_TEST_EXIT_WHEN_RELEASED: '1', DEV_TEST_RUNTIME_EXIT: code }),
      });
      const events = await waitForEvents(
        f.events,
        (events) =>
          events.filter(
            ({ role, type }) => role === 'grandchild' && type === 'ready',
          ).length === 2,
      );
      await delay(250);
      await writeFile(f.env.DEV_TEST_RELEASE, 'exit');
      const result = await run.done;
      assert.notEqual(result.code, null, result.output);
      if (code !== '0') assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /SIGTERM/);
      assertNoCredentials(result.output);
      await assertStopped(events.map(({ pid }) => pid));
      assert.equal(
        (await readEvents(f.events)).filter(
          ({ role, args, type }) =>
            role === 'lk' &&
            type === 'invoked' &&
            args.at(-1) === 'src/agent.py',
        ).length,
        1,
      );
    },
  );
}

test(
  'real concurrently: Ctrl+C stops both services and their grandchildren',
  {
    timeout: 15000,
    skip:
      windows &&
      'Node cannot send console Ctrl+C events on Windows; taskkill tree cleanup is tested separately.',
  },
  async (t) => {
    const f = await fixture(t);
    const run = await supervise(f, {
      DEV_TEST_RUNTIME_HOLD: '1',
      DEV_TEST_GRANDCHILD: '1',
      DEV_TEST_DETACHED: '1',
    });
    const events = await waitForEvents(
      f.events,
      (events) =>
        events.filter(
          ({ role, type }) => role === 'grandchild' && type === 'ready',
        ).length === 2,
    );
    await delay(250);
    // A terminal Ctrl+C targets the foreground group, including npm's shells.
    process.kill(-run.child.pid, 'SIGINT');
    const result = await run.done;
    // npm can re-raise SIGINT (Linux) or return an exit code (macOS). Both
    // represent a completed Ctrl+C; the essential contract is full cleanup.
    assert.ok(
      result.signal === 'SIGINT' || result.code !== null,
      result.output,
    );
    assertNoCredentials(result.output);
    await assertStopped(events.map(({ pid }) => pid));
  },
);

test(
  'a timed-out CLI probe reaps its descendants before Python fallback, including Windows cmd wrappers',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, { uv: true });
    const run = f.start('dev-agent.mjs', {
      DEV_TEST_PROBE: 'version-hang',
      DEV_TEST_PROBE_GRANDCHILD: '1',
      DEV_TEST_DETACHED: '1',
    });
    const events = await waitForEvents(f.events, (events) =>
      events.some(
        ({ role, type }) => role === 'grandchild' && type === 'ready',
      ),
    );
    const result = await run.done;
    assert.equal(result.code, 0, result.output);
    await assertStopped(events.map(({ pid }) => pid));
    const after = await readEvents(f.events);
    assert.equal(after.filter(({ role }) => role === 'uv').length, 1);
    assertNoCredentials(result.output);
  },
);

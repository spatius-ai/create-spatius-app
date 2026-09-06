import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertNoCredentials,
  assertStopped,
  credentials,
  fixture,
  readEvents,
  waitForEvents,
  windows,
} from './dev-fixtures.mjs';

test(
  'compatible lk uses the agent cwd, file credentials, and explicit inherited overrides',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const overrides = {
      LIVEKIT_API_KEY: 'inherited-api-key',
      SPATIUS_APP_ID: 'inherited-app-id',
      VIRTUAL_ENV: '/another/venv',
      UV_PROJECT_ENVIRONMENT: '/another/venv',
    };
    const result = await f.start('dev-agent.mjs', overrides).done;
    assert.equal(result.code, 0, result.output);
    const events = await readEvents(f.events);
    assert.deepEqual(
      events.map(({ role, args }) => [role, args]),
      [
        ['lk', ['--version']],
        ['lk', ['agent', 'dev', '--help']],
        ['lk', ['agent', 'dev', 'src/agent.py']],
      ],
    );
    for (const event of events) assert.equal(event.cwd, f.agent);
    for (const event of events.slice(0, 2))
      assert.ok(
        !Object.keys(event.env).some((key) => /^(LIVEKIT_|SPATIUS_)/.test(key)),
      );
    const runtime = events.at(-1);
    assert.equal(runtime.env.LIVEKIT_API_KEY, overrides.LIVEKIT_API_KEY);
    assert.equal(
      runtime.env.LIVEKIT_API_SECRET,
      credentials.LIVEKIT_API_SECRET,
    );
    assert.equal(runtime.env.SPATIUS_APP_ID, overrides.SPATIUS_APP_ID);
    assert.equal(runtime.env.VIRTUAL_ENV, join(f.agent, '.venv'));
    assert.equal(runtime.env.PATH.split(delimiter)[0], f.virtualBin);
    assert.equal(runtime.env.UV_PROJECT_ENVIRONMENT, join(f.agent, '.venv'));
    assert.equal(runtime.env.UV_NO_SYNC, '1');
    assert.equal(runtime.env.UV_PYTHON_DOWNLOADS, 'never');
    assertNoCredentials(result.output);
    assertNoCredentials(JSON.stringify(events.map(({ args }) => args)));
  },
);

test(
  'inherited credentials work without a local file and https URLs are accepted',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { local: null });
    const result = await f.start('dev-agent.mjs', {
      ...credentials,
      LIVEKIT_URL: 'https://dev-test.livekit.cloud',
    }).done;
    assert.equal(result.code, 0, result.output);
  },
);

for (const [name, local, overrides, expected] of [
  ['missing credentials', null, {}, /Missing agent development credentials/],
  [
    'empty override',
    credentials,
    { LIVEKIT_API_SECRET: '' },
    /LIVEKIT_API_SECRET/,
  ],
  [
    'example credentials',
    { ...credentials, SPATIUS_API_KEY: 'your-spatius-api-key' },
    {},
    /Replace example values/,
  ],
  [
    'invalid URL',
    credentials,
    { LIVEKIT_URL: 'invalid-private-server-value' },
    /LIVEKIT_URL must be/,
  ],
  [
    'insecure URL',
    credentials,
    { LIVEKIT_URL: 'http://localhost:7880' },
    /LIVEKIT_URL must be/,
  ],
  [
    'URL containing credentials',
    credentials,
    { LIVEKIT_URL: 'https://private:secret@example.com' },
    /LIVEKIT_URL must be/,
  ],
]) {
  test(
    `${name} fails before any probe or runtime with safe guidance`,
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, { local });
      const result = await f.start('dev-agent.mjs', overrides).done;
      assert.equal(result.code, 1);
      assert.match(result.output, expected);
      assert.match(result.output, /README.md/);
      assert.deepEqual(await readEvents(f.events), []);
      assertNoCredentials(result.output);
      for (const value of Object.values(overrides).filter(Boolean))
        assert.ok(!result.output.includes(value));
    },
  );
}

for (const manager of ['uv', 'pip']) {
  test(
    `${manager}: missing Python environment fails before lk without installing`,
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, { uv: manager === 'uv', python: false });
      const result = await f.start().done;
      assert.equal(result.code, 1);
      assert.match(result.output, /agent\/\.venv/);
      assert.deepEqual(await readEvents(f.events), []);
    },
  );
}

for (const [name, env] of [
  ['old version', { DEV_TEST_VERSION: 'lk version 2.18.1' }],
  ['prerelease version', { DEV_TEST_VERSION: 'lk version 2.18.2-beta.1' }],
  ['unknown version', { DEV_TEST_VERSION: 'private-probe-output' }],
  ['version failure', { DEV_TEST_VERSION_EXIT: '7' }],
  ['missing dev capability', { DEV_TEST_HELP: 'NAME: lk agent' }],
  ['help failure', { DEV_TEST_HELP_EXIT: '2' }],
  ['version timeout', { DEV_TEST_PROBE: 'version-hang' }],
  ['help timeout', { DEV_TEST_PROBE: 'help-hang' }],
  ['excessive probe output', { DEV_TEST_PROBE: 'flood' }],
]) {
  test(
    `${name} falls back once to selected uv without exposing probe output`,
    { timeout: 15000 },
    async (t) => {
      const f = await fixture(t, { uv: true });
      const result = await f.start('dev-agent.mjs', env).done;
      assert.equal(result.code, 0, result.output);
      const events = await readEvents(f.events);
      const runtimes = events.filter(({ role }) => role === 'uv');
      assert.equal(runtimes.length, 1);
      assert.deepEqual(runtimes[0].args, [
        'run',
        '--no-sync',
        '--directory',
        f.agent,
        '--extra',
        'dev',
        'python',
        '-m',
        'livekit.agents',
        'start',
        'src/agent.py',
        '--dev',
      ]);
      assert.equal(runtimes[0].cwd, f.agent);
      assert.equal(
        runtimes[0].env.LIVEKIT_API_SECRET,
        credentials.LIVEKIT_API_SECRET,
      );
      assert.equal(runtimes[0].env.UV_OFFLINE, '1');
      assert.ok(!result.output.includes('private-probe-output'));
      assertNoCredentials(result.output);
      await assertStopped(events.map(({ pid }) => pid));
    },
  );
}

test(
  'absent lk uses pip .venv python and propagates its exit without uv',
  {
    timeout: 10000,
    skip:
      windows &&
      'POSIX fake Python executable; Windows uv and lk cmd wrappers are exercised separately.',
  },
  async (t) => {
    const f = await fixture(t, { lk: false });
    const result = await f.start('dev-agent.mjs', {
      DEV_TEST_RUNTIME_EXIT: '23',
    }).done;
    assert.equal(result.code, 23, result.output);
    const events = await readEvents(f.events);
    assert.equal(events.length, 1);
    assert.equal(events[0].role, 'python');
    assert.deepEqual(events[0].args, [
      '-m',
      'livekit.agents',
      'start',
      'src/agent.py',
      '--dev',
    ]);
    assert.equal(events[0].cwd, f.agent);
  },
);

test(
  'uv selection never silently switches to pip when uv is missing',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { uv: true, lk: false });
    await rm(join(f.bin, windows ? 'uv.cmd' : 'uv'));
    const result = await f.start().done;
    assert.equal(result.code, 1);
    assert.match(result.output, /Could not launch the selected agent runtime/);
    assert.deepEqual(await readEvents(f.events), []);
    assertNoCredentials(result.output);
  },
);

test(
  'a compatible lk runtime failure propagates without fallback',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { uv: true });
    const result = await f.start('dev-agent.mjs', {
      DEV_TEST_RUNTIME_EXIT: '31',
    }).done;
    assert.equal(result.code, 31, result.output);
    assert.ok((await readEvents(f.events)).every(({ role }) => role === 'lk'));
  },
);

test(
  'the general Python check launcher needs no credentials and never probes lk',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { uv: true, local: null });
    const result = await f.start(
      'run-agent-python.mjs',
      { DEV_TEST_RUNTIME_EXIT: '19' },
      ['-m', 'unittest', 'discover', '-s', 'tests'],
    ).done;
    assert.equal(result.code, 19, result.output);
    const events = await readEvents(f.events);
    assert.equal(events.length, 1);
    assert.equal(events[0].role, 'uv');
    assert.deepEqual(events[0].args.slice(-5), [
      '-m',
      'unittest',
      'discover',
      '-s',
      'tests',
    ]);
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(
    `${signal} during a bounded probe stops without launching a fallback`,
    {
      timeout: 10000,
      skip:
        windows &&
        'Windows signals use forced taskkill; timeout tree cleanup is covered above.',
    },
    async (t) => {
      const f = await fixture(t, { uv: true });
      const run = f.start('dev-agent.mjs', { DEV_TEST_PROBE: 'version-hang' });
      const events = await waitForEvents(f.events, (events) =>
        events.some(({ type }) => type === 'ready'),
      );
      run.child.kill(signal);
      const result = await run.done;
      assert.equal(result.code, signal === 'SIGINT' ? 130 : 143, result.output);
      assert.ok(
        (await readEvents(f.events)).every(({ role }) => role === 'lk'),
      );
      await assertStopped(events.map(({ pid }) => pid));
    },
  );
}

for (const mode of ['signal', 'leader-exit', 'forced-signal']) {
  test(
    `${mode} cleans runtime grandchildren even in another process group`,
    {
      timeout: 15000,
      skip:
        windows &&
        'POSIX process groups; Windows taskkill /T is covered by supervision tests.',
    },
    async (t) => {
      const f = await fixture(t);
      const run = f.start('dev-agent.mjs', {
        DEV_TEST_RUNTIME_HOLD: '1',
        DEV_TEST_GRANDCHILD: '1',
        DEV_TEST_DETACHED: '1',
        DEV_TEST_EXIT_WHEN_RELEASED: '1',
        DEV_TEST_RUNTIME_EXIT: '17',
        DEV_TEST_IGNORE_SIGNALS: mode === 'forced-signal' ? '1' : '0',
      });
      const events = await waitForEvents(f.events, (events) =>
        events.some(
          ({ role, type }) => role === 'grandchild' && type === 'ready',
        ),
      );
      await delay(250);
      if (mode === 'leader-exit')
        await writeFile(f.env.DEV_TEST_RELEASE, 'exit');
      else run.child.kill('SIGTERM');
      const result = await run.done;
      assert.equal(
        result.code,
        mode === 'leader-exit' ? 17 : 143,
        result.output,
      );
      await assertStopped(events.map(({ pid }) => pid));
    },
  );
}

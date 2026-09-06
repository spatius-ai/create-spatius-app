import { createHmac } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { PromptCancelledError } from '../../src/errors.js';

import {
  createLiveKitEnvArguments,
  defaultLiveKitCommandRunner,
  loadLiveKitCredentialsWithCli,
  probeLiveKitCli,
  readLiveKitProjects,
  verifyLiveKitCredentials,
  type LiveKitCommandRunner,
} from '../../src/setup/livekit.js';

function runner(
  options: {
    capture?: LiveKitCommandRunner['capture'];
    interactive?: LiveKitCommandRunner['interactive'];
  } = {},
): LiveKitCommandRunner {
  return {
    capture:
      options.capture ??
      (async (_command, arguments_) =>
        arguments_.includes('--help')
          ? '--write --destination --example'
          : 'lk version 2.18.5'),
    interactive: options.interactive ?? (async () => undefined),
  };
}

describe('LiveKit CLI probing', () => {
  it('detects a compatible CLI and its version', async () => {
    await expect(probeLiveKitCli(runner())).resolves.toEqual({
      available: true,
      version: '2.18.5',
    });
  });

  it('distinguishes missing and incompatible CLIs', async () => {
    await expect(
      probeLiveKitCli(
        runner({ capture: async () => Promise.reject(new Error('missing')) }),
      ),
    ).resolves.toEqual({ available: false, reason: 'missing' });

    let calls = 0;
    await expect(
      probeLiveKitCli(
        runner({
          capture: async () => {
            calls += 1;
            return calls === 1 ? 'lk 2.0.0' : 'old help';
          },
        }),
      ),
    ).resolves.toEqual({
      available: false,
      reason: 'incompatible',
      version: '2.0.0',
    });

    calls = 0;
    const helpFailure = runner({
      capture: async () => {
        calls += 1;
        if (calls === 1) return 'unknown version';
        throw new Error('no app env');
      },
    });
    await expect(probeLiveKitCli(helpFailure)).resolves.toEqual({
      available: false,
      reason: 'incompatible',
    });
  });

  it('constructs the supported temporary-directory command only', () => {
    expect(createLiveKitEnvArguments('/secure/temp')).toEqual([
      'app',
      'env',
      '--write',
      '--destination',
      '.env.local',
      '--example',
      '.env.example',
      '/secure/temp',
    ]);
  });
});

describe('LiveKit credential extraction', () => {
  it('extracts valid values and removes the private temporary directory', async () => {
    const roots: string[] = [];
    const interactive = vi.fn<LiveKitCommandRunner['interactive']>(
      async (_command, arguments_, options) => {
        const directory = arguments_.at(-1)!;
        roots.push(directory);
        expect(options.cwd).toBe(directory);
        await writeFile(
          join(directory, '.env.local'),
          'LIVEKIT_URL=wss://demo.livekit.cloud\nLIVEKIT_API_KEY=key-123\nLIVEKIT_API_SECRET=secret-123\nUNRELATED=ignored\n',
        );
      },
    );

    await expect(
      loadLiveKitCredentialsWithCli({ runner: runner({ interactive }) }),
    ).resolves.toEqual({
      apiKey: 'key-123',
      apiSecret: 'secret-123',
      url: 'wss://demo.livekit.cloud',
    });
    expect(interactive).toHaveBeenCalledOnce();
    await expect(access(roots[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves cancellation and removes temporary credentials', async () => {
    let directory = '';
    await expect(
      loadLiveKitCredentialsWithCli({
        runner: runner({
          interactive: async (_command, args) => {
            directory = args.at(-1)!;
            throw new PromptCancelledError();
          },
        }),
      }),
    ).rejects.toBeInstanceOf(PromptCancelledError);
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed or placeholder output and still cleans up', async () => {
    let directory = '';
    await expect(
      loadLiveKitCredentialsWithCli({
        runner: runner({
          interactive: async (_command, arguments_) => {
            directory = arguments_.at(-1)!;
            await writeFile(
              join(directory, '.env.local'),
              'LIVEKIT_URL=http://invalid\nLIVEKIT_API_KEY=your-key\n',
            );
          },
        }),
      }),
    ).rejects.toThrow(/complete, valid credential set/u);
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails safely if the private temporary directory cannot be removed', async () => {
    const directory = join(tmpdir(), 'virtual-livekit-test');
    const remove = vi.fn(async () =>
      Promise.reject(new Error('simulated cleanup failure')),
    );
    const fileSystem = {
      chmod: vi.fn(async () => undefined),
      mkdtemp: vi.fn(async () => directory),
      readFile: vi.fn(async () =>
        Promise.resolve(
          'LIVEKIT_URL=https://demo.livekit.cloud\nLIVEKIT_API_KEY=key\nLIVEKIT_API_SECRET=secret\n',
        ),
      ),
      remove,
      writeFile: vi.fn(async () => undefined),
    };

    await expect(
      loadLiveKitCredentialsWithCli({ fileSystem, runner: runner() }),
    ).rejects.toThrow(/temporary LiveKit credential directory/u);
    expect(fileSystem.chmod).toHaveBeenCalledWith(directory, 0o700);
    expect(fileSystem.writeFile).toHaveBeenCalledWith(
      join(directory, '.env.example'),
      expect.stringContaining('LIVEKIT_API_SECRET'),
      0o600,
    );
    expect(remove).toHaveBeenCalledWith(directory);
  });
});

describe('default command runner', () => {
  it('captures successful output and rejects failed or timed-out commands', async () => {
    await expect(
      defaultLiveKitCommandRunner.capture(process.execPath, [
        '-e',
        'process.stdout.write("safe output")',
      ]),
    ).resolves.toBe('safe output');
    await expect(
      defaultLiveKitCommandRunner.capture(process.execPath, [
        '-e',
        'process.exit(2)',
      ]),
    ).rejects.toThrow(/unsuccessfully/u);
    await expect(
      defaultLiveKitCommandRunner.capture(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        { timeoutMs: 10 },
      ),
    ).rejects.toThrow(/timed out/u);
    await expect(
      defaultLiveKitCommandRunner.capture(
        'create-spatius-app-command-that-does-not-exist',
        [],
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it('runs an inherited-stdio command and reports failure safely', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'livekit-runner-'));
    try {
      await expect(
        defaultLiveKitCommandRunner.interactive(
          process.execPath,
          ['-e', 'process.exit(0)'],
          { cwd },
        ),
      ).resolves.toBeUndefined();
      await expect(
        defaultLiveKitCommandRunner.interactive(
          process.execPath,
          ['-e', 'process.exit(3)'],
          { cwd },
        ),
      ).rejects.toThrow(/did not complete/u);
      await expect(
        defaultLiveKitCommandRunner.interactive(
          process.execPath,
          ['-e', 'process.exit(130)'],
          { cwd },
        ),
      ).rejects.toBeInstanceOf(PromptCancelledError);
      await expect(
        defaultLiveKitCommandRunner.interactive(
          'create-spatius-app-command-that-does-not-exist',
          [],
          { cwd },
        ),
      ).rejects.toThrow(/could not be started/u);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });
});

describe('saved LiveKit projects', () => {
  it('returns display metadata and default without exposing credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lk-projects-'));
    const path = join(directory, 'cli-config.yaml');
    try {
      await expect(readLiveKitProjects(path)).resolves.toEqual([]);
      await writeFile(
        path,
        'default_project: production\nprojects:\n  - name: production\n    url: wss://prod.livekit.cloud\n    api_key: hidden-key\n    api_secret: hidden-secret\n  - name: staging\n    url: wss://stage.livekit.cloud\n',
      );
      await expect(readLiveKitProjects(path)).resolves.toEqual([
        {
          name: 'production',
          url: 'wss://prod.livekit.cloud',
          isDefault: true,
        },
        { name: 'staging', url: 'wss://stage.livekit.cloud', isDefault: false },
      ]);
      await writeFile(path, 'projects: [hidden-secret');
      await expect(readLiveKitProjects(path)).rejects.toThrow(
        'Saved LiveKit projects could not be read.',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('passes the selected project explicitly without changing the CLI default', () => {
    expect(createLiveKitEnvArguments('/temp', 'staging').slice(0, 4)).toEqual([
      '--project',
      'staging',
      'app',
      'env',
    ]);
  });
});

describe('LiveKit credential verification', () => {
  const credentials = {
    url: 'wss://demo.livekit.cloud',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  };
  it('signs a short-lived read-only request using the exact configured pair', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'));
    await verifyLiveKitCredentials(credentials, fetcher);
    const [url, options] = fetcher.mock.calls[0]!;
    expect((url as URL).href).toBe(
      'https://demo.livekit.cloud/twirp/livekit.RoomService/ListRooms',
    );
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      body: '{}',
    });
    const token = (
      options!.headers as Record<string, string>
    ).Authorization!.slice(7);
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(
      Buffer.from(payload!, 'base64url').toString(),
    ) as { exp: number; nbf: number };
    expect(claims).toMatchObject({
      iss: credentials.apiKey,
      video: { roomList: true },
    });
    expect(claims.exp - claims.nbf).toBe(65);
    expect(signature).toBe(
      createHmac('sha256', credentials.apiSecret)
        .update(`${header}.${payload}`)
        .digest('base64url'),
    );
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([401, 403, 429, 500, 302])(
    'rejects HTTP %s without leaking response content',
    async (status) => {
      await expect(
        verifyLiveKitCredentials(
          credentials,
          async () => new Response('hidden-secret', { status }),
        ),
      ).rejects.toThrow(
        status === 401 || status === 403
          ? /rejected these credentials/u
          : /verification failed/u,
      );
    },
  );
  it('distinguishes network failure from invalid credentials', async () => {
    await expect(
      verifyLiveKitCredentials(credentials, async () => {
        throw new Error('hidden-secret');
      }),
    ).rejects.toThrow(/network, TLS, or timeout/u);
  });
});

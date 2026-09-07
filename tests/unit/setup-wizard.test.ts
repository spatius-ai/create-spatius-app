import { describe, expect, it, vi } from 'vitest';

import { PromptCancelledError } from '../../src/errors.js';
import type {
  CredentialFileContents,
  CredentialFileState,
} from '../../src/setup/environment.js';
import { SpatiusAuthenticatedSession } from '../../src/setup/spatius-api.js';
import {
  type CredentialSetupDependencies,
  runCredentialSetup,
} from '../../src/setup/wizard.js';
import { FakePrompts } from '../setup-fixtures.js';

const missingState: CredentialFileState = {
  hasManagedValues: false,
  status: 'missing',
};
const examples: CredentialFileContents = {
  agent:
    'LIVEKIT_URL=your-url\nLIVEKIT_API_KEY=your-key\nLIVEKIT_API_SECRET=your-secret\nSPATIUS_API_KEY=your-key\nSPATIUS_APP_ID=your-app\n',
  worker:
    'LIVEKIT_URL=your-url\nLIVEKIT_API_KEY=your-key\nLIVEKIT_API_SECRET=your-secret\nLIVEKIT_AGENT_NAME=spatius-agent\nSPATIUS_APP_ID=your-app\nSPATIUS_AVATAR_ID=your-avatar\n',
};

function fakeSession(revoke = vi.fn(async () => undefined)) {
  return {
    authorized: async <Value>(
      operation: (accessToken: string) => Promise<Value>,
    ) => operation('access-token'),
    revoke,
  } as unknown as SpatiusAuthenticatedSession;
}

function writeMock() {
  return vi.fn(
    async (_targetDirectory: string, _contents: CredentialFileContents) =>
      undefined,
  );
}

function baseDependencies(
  overrides: CredentialSetupDependencies = {},
): CredentialSetupDependencies {
  const session = fakeSession();
  return {
    readLiveKitProjects: async () => [],
    verifyLiveKitCredentials: async () => undefined,
    authenticateLiveKit: async () => undefined,
    installLiveKit: async () => undefined,
    planLiveKitInstall: async () => undefined,
    createSpatiusClient: () => ({}) as never,
    loadLiveKitCredentials: async () => ({
      apiKey: 'livekit-key-secret',
      apiSecret: 'livekit-api-secret',
      url: 'wss://demo.livekit.cloud',
    }),
    loginToSpatius: async () => session,
    probeLiveKit: async () => ({ available: true, version: '2.18.5' }),
    readExamples: async () => examples,
    readState: async () => missingState,
    selectSpatiusResources: async () => ({
      apiKey: 'spatius-api-secret',
      appId: 'app-123',
      avatarId: 'avatar-123',
    }),
    validateProject: async () => undefined,
    writeFiles: async () => undefined,
    ...overrides,
  };
}

describe('credential setup wizard', () => {
  it.each([
    ['feminine', '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc'],
    ['masculine', 'a167e0f3-df7e-4d52-a9c3-f949145efdab'],
  ])(
    'saves the %s voice in Worker configuration only',
    async (style, voiceId) => {
      const writeFiles = writeMock();
      await runCredentialSetup({
        dependencies: baseDependencies({ writeFiles }),
        prompts: new FakePrompts({ choices: ['cli', 'browser', style] }),
        targetDirectory: '/project',
      });
      const written = writeFiles.mock.calls[0]?.[1];
      expect(written?.worker).toContain(`CARTESIA_VOICE_ID="${voiceId}"`);
      expect(written?.worker).toContain('SPATIUS_AVATAR_ID="avatar-123"');
      expect(written?.agent).not.toContain('CARTESIA_VOICE_ID');
    },
  );

  it('leaves files unchanged when voice selection is cancelled', async () => {
    const writeFiles = writeMock();
    const prompts = new FakePrompts();
    const choose = prompts.choose.bind(prompts);
    vi.spyOn(prompts, 'choose').mockImplementation(
      (message, options, initial) => {
        if (message.includes('character style'))
          throw new PromptCancelledError();
        return choose(message, options, initial);
      },
    );
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({ writeFiles }),
        prompts,
        targetDirectory: '/project',
      }),
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it('preserves a complete consistent configuration by default', async () => {
    const writeFiles = writeMock();
    const load = vi.fn(async () => ({
      apiKey: 'unused',
      apiSecret: 'unused',
      url: 'wss://unused.example',
    }));
    const prompts = new FakePrompts({ confirmations: [true] });

    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          loadLiveKitCredentials: load,
          readState: async () => ({
            agent: 'configured',
            hasManagedValues: true,
            status: 'complete',
            worker: 'configured',
          }),
          writeFiles,
        }),
        prompts,
        targetDirectory: '/project',
      }),
    ).resolves.toBe('unchanged');
    expect(load).not.toHaveBeenCalled();
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it('requires explicit replacement confirmation for partial or inconsistent values', async () => {
    const warning = vi.fn();
    const writeFiles = writeMock();
    for (const status of ['missing', 'inconsistent'] as const) {
      await expect(
        runCredentialSetup({
          dependencies: baseDependencies({
            readState: async () => ({
              hasManagedValues: true,
              status,
            }),
            writeFiles,
          }),
          onWarning: warning,
          prompts: new FakePrompts({ confirmations: [false] }),
          targetDirectory: '/project',
        }),
      ).resolves.toBe('unchanged');
    }
    expect(warning).toHaveBeenCalledTimes(2);
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it('uses LiveKit CLI and browser-approved Spatius resources, then revokes', async () => {
    const revoke = vi.fn(async () => undefined);
    const writeFiles = writeMock();
    const statuses: string[] = [];
    const login = vi.fn(
      async (options: {
        onAuthorizationUrl: (url: string) => void;
        onBrowserOpenFailure: (error: Error) => void;
      }) => {
        options.onAuthorizationUrl(
          'https://app.spatius.ai/cli/auth/request-id',
        );
        options.onBrowserOpenFailure(new Error('browser unavailable'));
        return fakeSession(revoke);
      },
    );

    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({ loginToSpatius: login, writeFiles }),
        onStatus: (message) => statuses.push(message),
        prompts: new FakePrompts(),
        targetDirectory: '/project',
      }),
    ).resolves.toBe('configured');

    expect(login).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
    expect(writeFiles).toHaveBeenCalledOnce();
    const written = writeFiles.mock.calls[0]?.[1];
    expect(written?.worker).toContain('SPATIUS_AVATAR_ID="avatar-123"');
    expect(written?.agent).toContain('SPATIUS_API_KEY="spatius-api-secret"');
    expect(written?.agent).not.toContain('SPATIUS_AVATAR_ID');
    expect(statuses.join('\n')).toContain('local development only');
  });

  it('falls back to fully masked manual entry when provider CLIs are unavailable', async () => {
    const writeFiles = writeMock();
    const prompts = new FakePrompts({
      choices: ['manual', 'manual', 'masculine'],
      inputs: ['https://demo.livekit.cloud'],
      passwords: [
        'manual-livekit-key',
        'manual-livekit-secret',
        'manual-spatius-key',
        'manual-app-id',
        'manual-avatar-id',
      ],
    });

    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          probeLiveKit: async () => ({ available: false, reason: 'missing' }),
          writeFiles,
        }),
        prompts,
        targetDirectory: '/project',
      }),
    ).resolves.toBe('configured');
    const written = writeFiles.mock.calls[0]?.[1];
    expect(written?.worker).toContain('LIVEKIT_API_KEY="manual-livekit-key"');
    expect(written?.agent).toContain('SPATIUS_API_KEY="manual-spatius-key"');
    expect(written?.worker).toContain(
      'CARTESIA_VOICE_ID="a167e0f3-df7e-4d52-a9c3-f949145efdab"',
    );
  });

  it('defaults to the existing voice when explicitly replacing credentials', async () => {
    const writeFiles = writeMock();
    const voiceId = 'a167e0f3-df7e-4d52-a9c3-f949145efdab';
    await runCredentialSetup({
      dependencies: baseDependencies({
        readState: async () => ({
          hasManagedValues: true,
          status: 'complete',
          worker: `CARTESIA_VOICE_ID=${voiceId}\n`,
        }),
        writeFiles,
      }),
      prompts: new FakePrompts({ confirmations: [false, true, true] }),
      targetDirectory: '/project',
    });
    expect(writeFiles.mock.calls[0]?.[1].worker).toContain(
      `CARTESIA_VOICE_ID="${voiceId}"`,
    );
  });

  it('offers manual LiveKit entry after CLI failure or malformed output', async () => {
    const writeFiles = writeMock();
    const prompts = new FakePrompts({
      choices: ['cli', 'manual', 'manual'],
      confirmations: [true, true],
      inputs: ['wss://fallback.livekit.cloud'],
      passwords: [
        'fallback-livekit-key',
        'fallback-livekit-secret',
        'manual-spatius-key',
        'manual-app',
        'manual-avatar',
      ],
    });
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          loadLiveKitCredentials: async () =>
            Promise.reject(new Error('failed')),
          writeFiles,
        }),
        prompts,
        targetDirectory: '/project',
      }),
    ).resolves.toBe('configured');
    expect(writeFiles.mock.calls[0]?.[1].worker).toContain(
      'wss://fallback.livekit.cloud',
    );
  });

  it('falls back to manual Spatius entry after browser authentication fails', async () => {
    const writeFiles = writeMock();
    const prompts = new FakePrompts({
      choices: ['cli', 'browser'],
      confirmations: [true, true],
      passwords: ['manual-key', 'manual-app', 'manual-avatar'],
    });
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          loginToSpatius: async () =>
            Promise.reject(new Error('loopback unavailable')),
          writeFiles,
        }),
        prompts,
        targetDirectory: '/project',
      }),
    ).resolves.toBe('configured');
    expect(writeFiles.mock.calls[0]?.[1].agent).toContain(
      'SPATIUS_API_KEY="manual-key"',
    );
  });

  it('surfaces safe recovery details while redacting browser-flow secrets', async () => {
    const warnings: string[] = [];
    const secret = 'distinctive-auth-code-secret';
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          loginToSpatius: async () =>
            Promise.reject(
              new Error(
                `The app was created with ID app-created, but auth_code=${secret}`,
              ),
            ),
        }),
        onWarning: (message) => warnings.push(message),
        prompts: new FakePrompts({
          choices: ['cli', 'browser'],
          confirmations: [false],
        }),
        targetDirectory: '/project',
      }),
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(warnings.join('\n')).toContain('app-created');
    expect(warnings.join('\n')).not.toContain(secret);
  });

  it('warns but succeeds when temporary-token revocation fails', async () => {
    const warnings: string[] = [];
    const session = fakeSession(
      vi.fn(async () => Promise.reject(new Error('revoke failed'))),
    );
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({ loginToSpatius: async () => session }),
        onWarning: (message) => warnings.push(message),
        prompts: new FakePrompts(),
        targetDirectory: '/project',
      }),
    ).resolves.toBe('configured');
    expect(warnings.join('\n')).toContain('could not be revoked');
  });

  it('saves after voice selection without a final confirmation', async () => {
    const writeFiles = writeMock();
    const prompts = new FakePrompts();
    const confirm = vi.spyOn(prompts, 'confirm');
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({ writeFiles }),
        prompts,
        targetDirectory: '/project',
      }),
    ).resolves.toBe('configured');
    expect(confirm).not.toHaveBeenCalled();
    expect(writeFiles).toHaveBeenCalledOnce();
  });

  it('leaves files unchanged when setup is deferred after a CLI failure', async () => {
    const writeFiles = writeMock();
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          loadLiveKitCredentials: async () => {
            throw new Error('failed');
          },
          writeFiles,
        }),
        prompts: new FakePrompts({ choices: ['cli', 'skip'] }),
        targetDirectory: '/project',
      }),
    ).resolves.toBe('unchanged');
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it.each(['missing', 'incompatible'] as const)(
    'installs or updates a %s CLI and continues without another source prompt',
    async (reason) => {
      const events: string[] = [];
      const plan = {
        command: 'installer',
        args: [],
        displayCommand: 'installer livekit',
      };
      const planInstall = vi.fn(async () => plan);
      const probeLiveKit = vi
        .fn()
        .mockResolvedValueOnce({ available: false, reason })
        .mockResolvedValue({ available: true });
      const prompts = new FakePrompts({ choices: ['install', 'browser'] });
      await expect(
        runCredentialSetup({
          dependencies: baseDependencies({
            probeLiveKit,
            planLiveKitInstall: planInstall,
            installLiveKit: async (selected) => {
              expect(selected).toBe(plan);
              events.push('install');
            },
            loadLiveKitCredentials: async () => {
              events.push('load');
              return {
                url: 'wss://demo.livekit.cloud',
                apiKey: 'key',
                apiSecret: 'secret',
              };
            },
          }),
          prompts,
          onStatus: (message) => events.push(message),
          targetDirectory: '/project',
        }),
      ).resolves.toBe('configured');
      expect(planInstall).toHaveBeenCalledWith(reason === 'incompatible');
      expect(
        events.findIndex((event) => event.includes('installer livekit')),
      ).toBeLessThan(events.indexOf('install'));
      expect(events.indexOf('install')).toBeLessThan(events.indexOf('load'));
      expect(probeLiveKit).toHaveBeenCalledTimes(2);
      expect(prompts.seenOptions).toHaveLength(3);
    },
  );

  it('rechecks an externally installed CLI without invoking an installer', async () => {
    const installLiveKit = vi.fn();
    await runCredentialSetup({
      dependencies: baseDependencies({
        probeLiveKit: vi
          .fn()
          .mockResolvedValueOnce({ available: false })
          .mockResolvedValue({ available: true }),
        installLiveKit,
      }),
      prompts: new FakePrompts({ choices: ['retry', 'browser'] }),
      targetDirectory: '/project',
    });
    expect(installLiveKit).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'recovers when installation fails or PATH remains unavailable (failure=%s)',
    async (fails) => {
      const warnings: string[] = [];
      const writeFiles = writeMock();
      const loadLiveKitCredentials = vi.fn();
      await expect(
        runCredentialSetup({
          dependencies: baseDependencies({
            probeLiveKit: async () => ({ available: false, reason: 'missing' }),
            planLiveKitInstall: async () => ({
              command: 'installer',
              args: [],
              displayCommand: 'installer',
            }),
            installLiveKit: async () => {
              if (fails) throw new Error('failed');
            },
            loadLiveKitCredentials,
            writeFiles,
          }),
          prompts: new FakePrompts({ choices: ['install', 'skip'] }),
          onWarning: (message) => warnings.push(message),
          targetDirectory: '/project',
        }),
      ).resolves.toBe('unchanged');
      expect(warnings.join(' ')).toContain(
        fails ? 'installation did not complete' : 'open a new terminal',
      );
      expect(loadLiveKitCredentials).not.toHaveBeenCalled();
      expect(writeFiles).not.toHaveBeenCalled();
    },
  );

  it('shows instructions without an install choice when no installer is available', async () => {
    const prompts = new FakePrompts({ choices: ['skip'] });
    const status: string[] = [];
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          probeLiveKit: async () => ({ available: false }),
        }),
        prompts,
        onStatus: (message) => status.push(message),
        targetDirectory: '/project',
      }),
    ).resolves.toBe('unchanged');
    expect(prompts.seenOptions[0]?.map((option) => option.value)).toEqual([
      'retry',
      'manual',
      'skip',
    ]);
    expect(status.join(' ')).toContain('https://docs.livekit.io/');
  });

  it('authenticates another project before extracting credentials and can retry', async () => {
    const events: string[] = [];
    const authenticateLiveKit = vi.fn(async () => {
      events.push('auth');
      if (events.length === 1) throw new Error('offline');
    });
    await runCredentialSetup({
      dependencies: baseDependencies({
        authenticateLiveKit,
        loadLiveKitCredentials: async () => {
          events.push('load');
          return {
            url: 'wss://demo.livekit.cloud',
            apiKey: 'key',
            apiSecret: 'secret',
          };
        },
      }),
      prompts: new FakePrompts({
        choices: ['connect', 'retry', 'connect', 'browser'],
      }),
      targetDirectory: '/project',
    });
    expect(events).toEqual(['auth', 'auth', 'load']);
  });

  it.each(['install', 'cli', 'connect'])(
    'propagates cancellation from %s without a fallback or credential write',
    async (source) => {
      const cancel = async () => {
        throw new PromptCancelledError();
      };
      const writeFiles = writeMock();
      const prompts = new FakePrompts({ choices: [source] });
      await expect(
        runCredentialSetup({
          dependencies: baseDependencies({
            probeLiveKit: async () => ({ available: source !== 'install' }),
            planLiveKitInstall: async () => ({
              command: 'installer',
              args: [],
              displayCommand: 'installer',
            }),
            installLiveKit: cancel,
            authenticateLiveKit: cancel,
            loadLiveKitCredentials: cancel,
            writeFiles,
          }),
          prompts,
          targetDirectory: '/project',
        }),
      ).rejects.toBeInstanceOf(PromptCancelledError);
      expect(prompts.seenOptions).toHaveLength(1);
      expect(writeFiles).not.toHaveBeenCalled();
    },
  );

  it('can defer setup even with a compatible CLI', async () => {
    const loadLiveKitCredentials = vi.fn();
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({ loadLiveKitCredentials }),
        prompts: new FakePrompts({ choices: ['skip'] }),
        targetDirectory: '/project',
      }),
    ).resolves.toBe('unchanged');
    expect(loadLiveKitCredentials).not.toHaveBeenCalled();
  });

  it('validates the project before reading credential files', async () => {
    const order: string[] = [];
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          readState: async () => {
            order.push('read');
            return missingState;
          },
          validateProject: async () => {
            order.push('validate');
            throw new Error('not a project');
          },
        }),
        prompts: new FakePrompts(),
        targetDirectory: '/unrelated',
      }),
    ).rejects.toThrow(/not a project/u);
    expect(order).toEqual(['validate']);
  });

  it('never includes seeded API keys or secrets in terminal summaries', async () => {
    const messages: string[] = [];
    const secrets = [
      'distinctive-livekit-key',
      'distinctive-livekit-secret',
      'distinctive-spatius-key',
    ];
    await runCredentialSetup({
      dependencies: baseDependencies({
        loadLiveKitCredentials: async () => ({
          apiKey: secrets[0]!,
          apiSecret: secrets[1]!,
          url: 'wss://safe.livekit.cloud',
        }),
        selectSpatiusResources: async () => ({
          apiKey: secrets[2]!,
          appId: 'visible-app-id',
          avatarId: 'visible-avatar-id',
        }),
      }),
      onStatus: (message) => messages.push(message),
      onWarning: (message) => messages.push(message),
      prompts: new FakePrompts(),
      targetDirectory: '/project',
    });

    for (const secret of secrets) {
      expect(messages.join('\n')).not.toContain(secret);
    }
  });
});

describe('LiveKit project selection and verification', () => {
  const projects = [
    { name: 'production', url: 'wss://prod.livekit.cloud', isDefault: true },
    { name: 'staging', url: 'wss://stage.livekit.cloud', isDefault: false },
  ];
  it('shows the default and uses the selected project', async () => {
    const load = vi.fn(async () => ({
      apiKey: 'key',
      apiSecret: 'secret',
      url: projects[1]!.url,
    }));
    const verify = vi.fn(async () => undefined);
    const prompts = new FakePrompts({
      choices: ['cli', 'staging', 'saved', 'browser'],
    });
    await runCredentialSetup({
      targetDirectory: '/project',
      prompts,
      dependencies: baseDependencies({
        readLiveKitProjects: async () => projects,
        loadLiveKitCredentials: load,
        verifyLiveKitCredentials: verify,
      }),
    });
    expect(prompts.seenOptions[0]![0]!.hint).toContain('Default: production');
    expect(load).toHaveBeenCalledWith('staging');
    expect(verify).toHaveBeenCalledWith({
      apiKey: 'key',
      apiSecret: 'secret',
      url: projects[1]!.url,
    });
  });
  it('uses a custom pair for the selected project and verifies before saving', async () => {
    const load = vi.fn();
    const verify = vi.fn(async () => undefined);
    const writeFiles = writeMock();
    await runCredentialSetup({
      targetDirectory: '/project',
      prompts: new FakePrompts({
        choices: ['cli', 'staging', 'custom', 'browser'],
        passwords: ['custom-key', 'custom-secret'],
      }),
      dependencies: baseDependencies({
        readLiveKitProjects: async () => projects,
        loadLiveKitCredentials: load,
        verifyLiveKitCredentials: verify,
        writeFiles,
      }),
    });
    expect(load).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledWith({
      apiKey: 'custom-key',
      apiSecret: 'custom-secret',
      url: projects[1]!.url,
    });
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(
      writeFiles.mock.invocationCallOrder[0]!,
    );
  });
  it('does not save or start Spatius setup after rejected credentials', async () => {
    const writeFiles = writeMock();
    const loginToSpatius = vi.fn();
    const result = await runCredentialSetup({
      targetDirectory: '/project',
      prompts: new FakePrompts({ choices: ['cli', 'skip'] }),
      dependencies: baseDependencies({
        verifyLiveKitCredentials: async () => {
          throw new Error('revoked');
        },
        writeFiles,
        loginToSpatius,
      }),
    });
    expect(result).toBe('unchanged');
    expect(writeFiles).not.toHaveBeenCalled();
    expect(loginToSpatius).not.toHaveBeenCalled();
  });
});

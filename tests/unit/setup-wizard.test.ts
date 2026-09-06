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
      choices: ['manual', 'masculine'],
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

  it('offers manual LiveKit entry after CLI cancellation or malformed output', async () => {
    const writeFiles = writeMock();
    const prompts = new FakePrompts({
      choices: ['cli', 'manual'],
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

  it('leaves files unchanged on final cancellation or provider failure', async () => {
    const writeFiles = writeMock();
    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({ writeFiles }),
        prompts: new FakePrompts({ confirmations: [false] }),
        targetDirectory: '/project',
      }),
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(writeFiles).not.toHaveBeenCalled();

    await expect(
      runCredentialSetup({
        dependencies: baseDependencies({
          loadLiveKitCredentials: async () =>
            Promise.reject(new Error('CLI failed')),
          writeFiles,
        }),
        prompts: new FakePrompts({
          choices: ['cli'],
          confirmations: [false],
        }),
        targetDirectory: '/project',
      }),
    ).rejects.toBeInstanceOf(PromptCancelledError);
    expect(writeFiles).not.toHaveBeenCalled();
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

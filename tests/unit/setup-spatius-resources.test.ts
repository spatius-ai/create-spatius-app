import { describe, expect, it, vi } from 'vitest';

import { PromptCancelledError } from '../../src/errors.js';
import { SecretRedactor } from '../../src/setup/redaction.js';
import {
  SpatiusApiClient,
  SpatiusAuthenticatedSession,
} from '../../src/setup/spatius-api.js';
import {
  apiKeyLabel,
  combineAvatars,
  selectSpatiusResources,
} from '../../src/setup/spatius-resources.js';
import { FakePrompts } from '../setup-fixtures.js';

function fakeSession(): SpatiusAuthenticatedSession {
  return {
    authorized: async <Value>(
      operation: (accessToken: string) => Promise<Value>,
    ) => operation('console-access-token'),
    revoke: async () => undefined,
  } as SpatiusAuthenticatedSession;
}

function fakeClient(overrides: Record<string, unknown> = {}): SpatiusApiClient {
  return {
    createApiKey: vi.fn(async () => ({ apiKey: 'created-api-key' })),
    createApp: vi.fn(async (_token: string, name: string) => ({
      appId: 'created-app',
      name,
    })),
    listApiKeys: vi.fn(async () => [
      {
        apiKey: 'existing-secret-api-key',
        createdAt: '2026-03-29T13:00:00Z',
      },
    ]),
    listApps: vi.fn(async () => [{ appId: 'app-1', name: 'Existing app' }]),
    listPersonalAvatars: vi.fn(async () => [
      { id: 'personal-1', name: 'Personal avatar', source: 'personal' },
    ]),
    listPublicAvatars: vi.fn(async () => [
      { id: 'public-1', name: 'Public avatar', source: 'public' },
    ]),
    ...overrides,
  } as unknown as SpatiusApiClient;
}

function select(
  client: SpatiusApiClient,
  prompts: FakePrompts,
  onWarning = vi.fn(),
) {
  return selectSpatiusResources({
    client,
    onWarning,
    projectName: 'demo-project',
    prompts,
    redactor: new SecretRedactor(),
    session: fakeSession(),
  });
}

describe('Spatius resource selection', () => {
  it('keeps a public background through selection and duplicate personal entries', async () => {
    const result = await select(
      fakeClient({
        listPublicAvatars: async () => [
          {
            id: 'same',
            name: 'Public',
            source: 'public',
            backgroundUrl: 'https://cdn.example.com/room.jpg',
          },
        ],
        listPersonalAvatars: async () => [
          { id: 'same', name: 'Personal', source: 'personal' },
        ],
      }),
      new FakePrompts(),
    );
    expect(result).toMatchObject({
      avatarId: 'same',
      backgroundUrl: 'https://cdn.example.com/room.jpg',
    });
  });

  it('deduplicates public/personal avatars and lets personal metadata win', () => {
    expect(
      combineAvatars(
        [
          { id: 'same', name: 'Public name', source: 'public' },
          { id: 'public', name: 'Public', source: 'public' },
        ],
        [
          { id: 'same', name: 'Personal name', source: 'personal' },
          { id: 'personal', name: 'Personal', source: 'personal' },
        ],
      ),
    ).toEqual([
      { id: 'same', name: 'Personal name', source: 'personal' },
      { id: 'public', name: 'Public', source: 'public' },
      { id: 'personal', name: 'Personal', source: 'personal' },
    ]);
  });

  it('masks key labels and formats valid or unavailable dates', () => {
    expect(
      apiKeyLabel({
        apiKey: 'existing-secret-api-key',
        createdAt: '2026-03-29T13:00:00Z',
      }),
    ).toBe('••••-key · created 2026-03-29');
    expect(apiKeyLabel({ apiKey: 'tiny' })).toContain(
      'creation date unavailable',
    );
    expect(
      apiKeyLabel({ apiKey: 'another-key', createdAt: 'invalid' }),
    ).toContain('creation date unavailable');
  });

  it('defaults to an existing app, existing key, and public avatar', async () => {
    const prompts = new FakePrompts();
    const result = await select(fakeClient(), prompts);

    expect(result).toEqual({
      apiKey: 'existing-secret-api-key',
      appId: 'app-1',
      avatarId: 'public-1',
    });
    expect(JSON.stringify(prompts.seenOptions)).not.toContain(
      'existing-secret-api-key',
    );
    expect(JSON.stringify(prompts.seenOptions)).toContain('••••-key');
  });

  it('selects a personal avatar and deduplicates its public copy', async () => {
    const client = fakeClient({
      listPersonalAvatars: vi.fn(async () => [
        { id: 'public-1', name: 'Mine now', source: 'personal' },
        { id: 'personal-1', name: 'Personal', source: 'personal' },
      ]),
    });
    const prompts = new FakePrompts({
      choices: ['app-0', 'key-0', 'avatar-1'],
    });

    await expect(select(client, prompts)).resolves.toMatchObject({
      avatarId: 'personal-1',
    });
    expect(JSON.stringify(prompts.seenOptions)).toContain(
      'Mine now (personal)',
    );
  });

  it('continues with public avatars when personal access is unavailable', async () => {
    const warning = vi.fn();
    const client = fakeClient({
      listPersonalAvatars: vi.fn(async () =>
        Promise.reject(new Error('forbidden')),
      ),
    });

    await expect(
      select(client, new FakePrompts(), warning),
    ).resolves.toMatchObject({ avatarId: 'public-1' });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('public'));
  });

  it('creates a new key only after explicit confirmation', async () => {
    const createApiKey = vi.fn(async () => ({ apiKey: 'new-secret-key' }));
    const client = fakeClient({ createApiKey });
    const prompts = new FakePrompts({
      choices: ['app-0', 'create-key', 'avatar-0'],
      confirmations: [true],
    });

    await expect(select(client, prompts)).resolves.toMatchObject({
      apiKey: 'new-secret-key',
      appId: 'app-1',
    });
    expect(createApiKey).toHaveBeenCalledWith('console-access-token', 'app-1');

    await expect(
      select(
        fakeClient(),
        new FakePrompts({
          choices: ['app-0', 'create-key'],
          confirmations: [false],
        }),
      ),
    ).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it('defaults to creating a key when an existing app has none', async () => {
    const client = fakeClient({ listApiKeys: vi.fn(async () => []) });
    await expect(
      select(client, new FakePrompts({ confirmations: [true] })),
    ).resolves.toMatchObject({ apiKey: 'created-api-key' });
  });

  it('creates an explicitly named app and its first key after confirmation', async () => {
    const createApp = vi.fn(async (_token: string, name: string) => ({
      appId: 'new-app-id',
      name,
    }));
    const createApiKey = vi.fn(async () => ({ apiKey: 'first-new-key' }));
    const client = fakeClient({
      createApiKey,
      createApp,
      listApps: vi.fn(async () => []),
    });
    const prompts = new FakePrompts({
      choices: ['create-app', 'avatar-0'],
      confirmations: [true],
      inputs: ['Custom app'],
    });

    await expect(select(client, prompts)).resolves.toMatchObject({
      apiKey: 'first-new-key',
      appId: 'new-app-id',
    });
    expect(createApp).toHaveBeenCalledWith(
      'console-access-token',
      'Custom app',
    );
  });

  it('reports a partially created app without exposing a key', async () => {
    const client = fakeClient({
      createApiKey: vi.fn(async () => Promise.reject(new Error('failed'))),
      listApps: vi.fn(async () => []),
    });
    const prompts = new FakePrompts({
      choices: ['create-app'],
      confirmations: [true],
      inputs: ['Custom app'],
    });

    await expect(select(client, prompts)).rejects.toThrow(
      /created with ID created-app/u,
    );
  });

  it('retains a manual avatar fallback and validates its value', async () => {
    const prompts = new FakePrompts({
      choices: ['app-0', 'key-0', 'manual-avatar'],
      inputs: ['manual-avatar-id'],
    });
    await expect(select(fakeClient(), prompts)).resolves.toMatchObject({
      avatarId: 'manual-avatar-id',
    });

    await expect(
      select(
        fakeClient(),
        new FakePrompts({
          choices: ['app-0', 'key-0', 'manual-avatar'],
          inputs: ['your-avatar-id'],
        }),
      ),
    ).rejects.toThrow(/non-placeholder/u);
  });

  it('defaults to manual avatar entry when no avatars can be listed', async () => {
    const client = fakeClient({
      listPersonalAvatars: vi.fn(async () => []),
      listPublicAvatars: vi.fn(async () => []),
    });
    await expect(
      select(client, new FakePrompts({ inputs: ['only-avatar-id'] })),
    ).resolves.toMatchObject({ avatarId: 'only-avatar-id' });
  });
});

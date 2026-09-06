import { describe, expect, it, vi } from 'vitest';

import { handleRequest } from './index.js';
import { createSession } from './session.js';

const TEST_ENV = {
  CARTESIA_VOICE_ID: '',
  LIVEKIT_AGENT_NAME: 'spatius-agent',
  LIVEKIT_API_KEY: 'test-api-key',
  LIVEKIT_API_SECRET: 'test-api-secret-with-enough-entropy',
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  SPATIUS_APP_ID: 'test-app-id',
  SPATIUS_AVATAR_ID: 'test-avatar-id',
  SPATIUS_AVATAR_BACKGROUND_URL: '',
} satisfies CloudflareBindings;

describe('createSession', () => {
  it.each([
    '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
    'a167e0f3-df7e-4d52-a9c3-f949145efdab',
  ])(
    'dispatches the configured voice alongside the avatar: %s',
    async (voiceId) => {
      const session = await createSession({
        ...TEST_ENV,
        CARTESIA_VOICE_ID: voiceId,
      });
      const payload = JSON.parse(
        atob(session.participant_token.split('.')[1]),
      ) as {
        roomConfig: { agents: Array<{ metadata: string }> };
      };
      expect(JSON.parse(payload.roomConfig.agents[0].metadata)).toEqual({
        version: 1,
        avatar: { id: TEST_ENV.SPATIUS_AVATAR_ID },
        voice: { id: voiceId },
      });
    },
  );
  it('exposes only the optional public background URL, without changing dispatch metadata', async () => {
    const background = 'https://cdn.example.com/background.jpg';
    const result = await createSession({
      ...TEST_ENV,
      SPATIUS_AVATAR_BACKGROUND_URL: background,
    });
    expect(result.spatius_avatar_background_url).toBe(background);
    expect(await createSession(TEST_ENV)).not.toHaveProperty(
      'spatius_avatar_background_url',
    );
  });
  it('creates an anonymous room and a short-lived participant token', async () => {
    const identifiers = ['room-id', 'participant-id'];
    const session = await createSession(TEST_ENV, () => identifiers.shift()!);

    expect(session).toMatchObject({
      room_name: 'spatius-room-id',
      server_url: TEST_ENV.LIVEKIT_URL,
      spatius_app_id: TEST_ENV.SPATIUS_APP_ID,
      spatius_avatar_id: TEST_ENV.SPATIUS_AVATAR_ID,
    });
    expect(session).not.toHaveProperty('spatius_region');
    expect(session.participant_token.split('.')).toHaveLength(3);

    const encodedPayload = session.participant_token.split('.')[1];
    const payload = JSON.parse(atob(encodedPayload)) as {
      exp: number;
      nbf: number;
      roomConfig: {
        agents: Array<{ agentName: string; metadata: string }>;
      };
      sub: string;
      video: { room: string; roomJoin: boolean };
    };

    expect(payload.sub).toBe('web-participant-id');
    expect(payload.exp - payload.nbf).toBe(600);
    expect(payload.video).toMatchObject({
      room: 'spatius-room-id',
      roomJoin: true,
    });
    expect(payload.roomConfig.agents).toEqual([
      expect.objectContaining({
        agentName: 'spatius-agent',
        metadata: JSON.stringify({
          avatar: { id: TEST_ENV.SPATIUS_AVATAR_ID },
          version: 1,
        }),
      }),
    ]);
  });

  it('rejects missing configuration without leaking secret values', async () => {
    await expect(
      createSession({ ...TEST_ENV, LIVEKIT_API_SECRET: '' }),
    ).rejects.toThrow('LIVEKIT_API_SECRET');
  });
});

describe('Worker routes', () => {
  it('returns a no-store session response', async () => {
    const response = await handleRequest(
      new Request('https://example.com/api/session', { method: 'POST' }),
      TEST_ENV,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({
      server_url: TEST_ENV.LIVEKIT_URL,
      spatius_app_id: TEST_ENV.SPATIUS_APP_ID,
      spatius_avatar_id: TEST_ENV.SPATIUS_AVATAR_ID,
    });
    expect(JSON.stringify(body)).not.toContain(TEST_ENV.LIVEKIT_API_SECRET);
  });

  it('reports health and rejects unsupported routes and methods', async () => {
    const health = await handleRequest(
      new Request('https://example.com/api/health'),
      TEST_ENV,
    );
    const wrongMethod = await handleRequest(
      new Request('https://example.com/api/session'),
      TEST_ENV,
    );
    const missing = await handleRequest(
      new Request('https://example.com/api/missing'),
      TEST_ENV,
    );

    await expect(health.json()).resolves.toEqual({ ok: true });
    expect(wrongMethod.status).toBe(405);
    expect(missing.status).toBe(404);
  });

  it('returns a safe configuration error', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const response = await handleRequest(
      new Request('https://example.com/api/session', { method: 'POST' }),
      { ...TEST_ENV, LIVEKIT_API_KEY: '' },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error:
        'The voice session service is not configured. Check the Worker environment.',
    });
    consoleError.mockRestore();
  });
});

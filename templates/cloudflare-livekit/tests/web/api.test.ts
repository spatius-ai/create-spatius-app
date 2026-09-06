import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestVoiceSession } from '../../web/api.js';
afterEach(() => vi.unstubAllGlobals());
describe('session bootstrap', () => {
  it.each([
    'https://cdn.example.com/room.jpg',
    'javascript:alert(1)',
    'https://user:password@example.com/image',
    42,
    null,
  ])(
    'accepts only safe optional public backgrounds: %s',
    async (background) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          Response.json({
            server_url: 'wss://example.invalid',
            participant_token: 'token',
            room_name: 'room',
            spatius_app_id: 'app',
            spatius_avatar_id: 'avatar',
            spatius_avatar_background_url: background,
          }),
        ),
      );
      const result = await requestVoiceSession();
      expect(result.spatius_avatar_background_url).toBe(
        background === 'https://cdn.example.com/room.jpg'
          ? background
          : undefined,
      );
    },
  );

  it('POSTs with cancellation and no cache, validating the response', async () => {
    const payload = {
      server_url: 'wss://example.invalid',
      participant_token: 'token',
      room_name: 'room',
      spatius_app_id: 'app',
      spatius_avatar_id: 'avatar',
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    expect(await requestVoiceSession(signal)).toEqual(payload);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/session',
      expect.objectContaining({ method: 'POST', cache: 'no-store', signal }),
    );
  });
  it('rejects malformed success and non-JSON failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(new Response('offline', { status: 503 })),
    );
    await expect(requestVoiceSession()).rejects.toThrow('invalid response');
    await expect(requestVoiceSession()).rejects.toThrow('Could not start');
  });
});

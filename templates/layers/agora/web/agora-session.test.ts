// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AgoraSession } from './agora-session.js';
afterEach(() => vi.unstubAllGlobals());
it('stops a remotely created agent when cancellation precedes the bootstrap response', async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const session = new AgoraSession(vi.fn(), vi.fn());
  const starting = session.start(document.createElement('div'));
  const rejected = expect(starting).rejects.toMatchObject({
    name: 'AbortError',
  });
  const stopping = session.dispose();
  complete(
    Response.json({
      capability: 'signed-session',
      appId: 'app',
      channel: 'channel',
      uid: 123,
      agentUid: 456,
      token: 'client-token',
      spatiusAppId: 'spatius',
      avatarId: 'avatar',
      region: 'region',
    }),
  );
  await rejected;
  await stopping;
  await session.dispose();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]).toEqual([
    '/api/session/stop',
    expect.objectContaining({
      body: JSON.stringify({ capability: 'signed-session' }),
      keepalive: true,
    }),
  ]);
});
it('rejects malformed bootstrap responses without initializing media', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
  const session = new AgoraSession(vi.fn(), vi.fn());
  await expect(session.start(document.createElement('div'))).rejects.toThrow(
    'Invalid session response',
  );
  await session.dispose();
});
it('keeps provider errors out of the browser error message', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response('private provider diagnostic', { status: 502 }),
      ),
  );
  const session = new AgoraSession(vi.fn(), vi.fn());
  await expect(session.start(document.createElement('div'))).rejects.toThrow(
    'Could not start the agent.',
  );
  await expect(session.send('hello')).rejects.toThrow('Not connected');
});

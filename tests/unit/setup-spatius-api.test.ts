import { describe, expect, it, vi } from 'vitest';

import {
  SpatiusApiClient,
  SpatiusAuthenticatedSession,
  SpatiusHttpError,
  type SpatiusRequestDiagnostic,
} from '../../src/setup/spatius-api.js';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('Spatius API client', () => {
  it.each(['backgroundImageUrl', 'background_image_url'])(
    'reads public avatar background metadata (%s)',
    async (field) => {
      const client = new SpatiusApiClient(undefined, async () =>
        json({
          publicAvatars: [
            {
              id: 'public-avatar',
              name: 'Public avatar',
              [field]: 'https://cdn.example.com/room.jpg',
            },
          ],
        }),
      );
      expect(await client.listPublicAvatars('token')).toEqual([
        {
          id: 'public-avatar',
          name: 'Public avatar',
          source: 'public',
          backgroundUrl: 'https://cdn.example.com/room.jpg',
        },
      ]);
    },
  );

  it('uses the Studio API domain for authentication by default', async () => {
    const requests: Request[] = [];
    const client = new SpatiusApiClient(undefined, async (input, init) => {
      requests.push(new Request(input, init));
      return json({
        authRequestId: 'request-1',
        authorizeUrl: 'https://app.spatius.ai/cli/auth/request-1',
      });
    });

    await client.createAuthSession({
      codeChallenge: 'challenge',
      redirectUri: 'http://127.0.0.1:1000/callback',
      state: 'state',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'https://api.studio.spatius.ai/v1/cli/auth/sessions',
    );
    expect(requests[0]?.method).toBe('POST');
  });

  it('implements auth, paginated resources, mutations, and app authentication', async () => {
    const requests: Request[] = [];
    const mockFetch = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);

      if (url.pathname === '/v1/cli/auth/sessions') {
        return json({
          auth_request_id: 'request-1',
          authorize_url: 'https://app.spatius.ai/cli/auth/request-1',
          expires_at: '2030-01-01T00:00:00Z',
          expires_in: 600,
        });
      }
      if (url.pathname === '/v1/cli/auth/token') {
        return json({
          token: {
            access_token: 'access-1',
            refresh_token: 'refresh-1',
          },
        });
      }
      if (url.pathname === '/v1/cli/auth/token:refresh') {
        return json({
          token: { accessToken: 'access-2', refreshToken: 'refresh-2' },
        });
      }
      if (url.pathname === '/v1/cli/auth/token:revoke') {
        return new Response(undefined, { status: 204 });
      }
      if (url.pathname === '/v1/apps' && request.method === 'POST') {
        return json({ appId: 'app-new' });
      }
      if (url.pathname === '/v1/apps') {
        return url.searchParams.get('pagination.pageToken') === null
          ? json({
              apps: [
                {
                  app_id: 'app-1',
                  created_at: '2026-01-01T00:00:00Z',
                  name: 'First',
                },
              ],
              pagination: { next_page_token: 'next' },
            })
          : json({
              apps: [{ appId: 'app-2', name: 'Second' }],
              pagination: {},
            });
      }
      if (
        url.pathname === '/v1/apps/app-1/api-keys' &&
        request.method === 'POST'
      ) {
        return json({
          apiKey: {
            apiKey: 'new-spatius-api-key',
            createdAt: '2026-04-01T00:00:00Z',
          },
        });
      }
      if (url.pathname === '/v1/apps/app-1/api-keys') {
        return url.searchParams.get('pagination.pageToken') === null
          ? json({
              api_keys: [
                {
                  api_key: 'existing-spatius-api-key',
                  created_at: '2026-03-01T00:00:00Z',
                },
              ],
              pagination: { nextPageToken: 'key-next' },
            })
          : json({ apiKeys: [{ apiKey: 'second-key' }] });
      }
      if (url.pathname === '/v2/console/public-avatars') {
        return url.searchParams.get('pagination.pageToken') === null
          ? json({
              public_avatars: [{ id: 'avatar-public', name: 'Public' }],
              pagination: { nextPageToken: 'avatar-next' },
            })
          : json({ publicAvatars: [] });
      }
      if (url.pathname === '/v1/open/avatars') {
        expect(request.headers.get('X-App-ID')).toBe('app-1');
        expect(request.headers.get('X-API-Key')).toBe(
          'existing-spatius-api-key',
        );
        return json({ avatars: [{ id: 'avatar-personal', name: 'Personal' }] });
      }
      throw new Error(`unexpected ${request.method} ${url.pathname}`);
    });
    const client = new SpatiusApiClient('https://api.example.test/', mockFetch);

    await expect(
      client.createAuthSession({
        codeChallenge: 'challenge',
        redirectUri: 'http://127.0.0.1:1000/callback',
        state: 'state',
      }),
    ).resolves.toEqual({
      authRequestId: 'request-1',
      authorizeUrl: 'https://app.spatius.ai/cli/auth/request-1',
      expiresAt: '2030-01-01T00:00:00Z',
      expiresIn: 600,
    });
    await expect(
      client.exchangeAuthCode({
        authCode: 'code',
        authRequestId: 'request-1',
        codeVerifier: 'verifier',
      }),
    ).resolves.toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    await expect(client.refresh('refresh-1')).resolves.toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
    await expect(
      client.revoke({ accessToken: 'access-2', refreshToken: 'refresh-2' }),
    ).resolves.toBeUndefined();
    await expect(client.listApps('access-2')).resolves.toEqual([
      {
        appId: 'app-1',
        createdAt: '2026-01-01T00:00:00Z',
        name: 'First',
      },
      { appId: 'app-2', name: 'Second' },
    ]);
    await expect(client.createApp('access-2', 'New app')).resolves.toEqual({
      appId: 'app-new',
      name: 'New app',
    });
    await expect(client.listApiKeys('access-2', 'app-1')).resolves.toEqual([
      {
        apiKey: 'existing-spatius-api-key',
        createdAt: '2026-03-01T00:00:00Z',
      },
      { apiKey: 'second-key' },
    ]);
    await expect(client.createApiKey('access-2', 'app-1')).resolves.toEqual({
      apiKey: 'new-spatius-api-key',
      createdAt: '2026-04-01T00:00:00Z',
    });
    await expect(client.listPublicAvatars('access-2')).resolves.toEqual([
      { id: 'avatar-public', name: 'Public', source: 'public' },
    ]);
    await expect(
      client.listPersonalAvatars('app-1', 'existing-spatius-api-key'),
    ).resolves.toEqual([
      { id: 'avatar-personal', name: 'Personal', source: 'personal' },
    ]);

    const sessionRequest = requests.find(
      (request) => new URL(request.url).pathname === '/v1/cli/auth/sessions',
    )!;
    await expect(sessionRequest.json()).resolves.toMatchObject({
      clientName: 'create-spatius-app',
      codeChallengeMethod: 'CLI_AUTH_CODE_CHALLENGE_METHOD_S256',
    });
    expect(
      requests
        .find((request) => new URL(request.url).pathname === '/v1/apps')
        ?.headers.get('Authorization'),
    ).toBe('Bearer access-2');
  });

  it('does not include provider response bodies or secret requests in errors', async () => {
    const secret = 'distinctive-secret-do-not-print';
    const client = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () => json({ message: secret }, 500)),
    );
    const error = await client
      .exchangeAuthCode({
        authCode: secret,
        authRequestId: 'request',
        codeVerifier: secret,
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SpatiusHttpError);
    expect(String(error)).not.toContain(secret);
  });

  it('reports network, JSON, and response-shape failures safely', async () => {
    const network = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () => Promise.reject(new Error('socket secret'))),
    );
    await expect(network.listApps('token')).rejects.toThrow(/Could not reach/u);

    const invalidJson = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () => new Response('not-json')),
    );
    await expect(invalidJson.listApps('token')).rejects.toThrow(
      /invalid JSON/u,
    );

    const invalidShape = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () => json('wrong shape')),
    );
    await expect(invalidShape.listApps('token')).rejects.toThrow(
      /invalid .* response/u,
    );

    const missingField = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () => json({ authorizeUrl: 'https://example.test' })),
    );
    await expect(
      missingField.createAuthSession({
        codeChallenge: 'challenge',
        redirectUri: 'http://127.0.0.1/callback',
        state: 'state',
      }),
    ).rejects.toThrow(/authRequestId/u);
  });

  it('accepts omitted optional auth expiry fields', async () => {
    const client = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () =>
        json({
          authRequestId: 'request',
          authorizeUrl: 'https://app.spatius.ai/auth/request',
        }),
      ),
    );
    await expect(
      client.createAuthSession({
        codeChallenge: 'challenge',
        redirectUri: 'http://127.0.0.1/callback',
        state: 'state',
      }),
    ).resolves.toEqual({
      authRequestId: 'request',
      authorizeUrl: 'https://app.spatius.ai/auth/request',
    });
  });

  it('retains the current refresh token when a refresh response omits it', async () => {
    const client = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () =>
        json({
          token: { accessToken: 'new-access' },
        }),
      ),
    );

    await expect(client.refresh('current-refresh')).resolves.toEqual({
      accessToken: 'new-access',
      refreshToken: 'current-refresh',
    });
  });

  it('refreshes once after an unauthorized operation and never retries other errors', async () => {
    const refresh = vi.fn<typeof fetch>(async () =>
      json({
        token: { accessToken: 'new-access', refreshToken: 'new-refresh' },
      }),
    );
    const client = new SpatiusApiClient('https://api.example.test', refresh);
    const session = new SpatiusAuthenticatedSession(client, {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    });
    const operation = vi.fn(async (accessToken: string) => {
      if (accessToken === 'old-access') {
        throw new SpatiusHttpError(401, 'GET', '/protected');
      }
      return accessToken;
    });

    await expect(session.authorized(operation)).resolves.toBe('new-access');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();

    await expect(
      session.authorized(async () => {
        throw new SpatiusHttpError(403, 'GET', '/protected');
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(refresh).toHaveBeenCalledOnce();
    await expect(session.revoke()).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('stops pagination when a provider repeats its page token', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ apps: [], pagination: { nextPageToken: 'same' } }),
    );
    const client = new SpatiusApiClient('https://api.example.test', fetchMock);

    await expect(client.listApps('token')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recognizes the production HTTP-200 configuration error before reading auth fields', async () => {
    const diagnostics: SpatiusRequestDiagnostic[] = [];
    const client = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () =>
        json({
          errors: [
            {
              status: 500,
              code: 'INTERNAL_SERVER_ERROR',
              title: 'Internal Server Error',
              detail: 'server open-platform frontend URL is not configured',
            },
          ],
        }),
      ),
      (event) => diagnostics.push(event),
    );
    const error = await client
      .createAuthSession({
        codeChallenge: 'private-challenge',
        redirectUri: 'http://127.0.0.1:1234/callback',
        state: 'private-state',
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 500,
      httpStatus: 200,
      apiCode: 'INTERNAL_SERVER_ERROR',
    });
    expect(String(error)).toContain('SERVER_OPEN_PLATFORM_FRONTEND_URL');
    expect(String(error)).not.toContain('without authRequestId');
    expect(diagnostics).toEqual([
      {
        method: 'POST',
        route: '/v1/cli/auth/sessions',
        durationMs: expect.any(Number) as number,
        outcome: 'response',
        httpStatus: 200,
        apiStatus: 500,
        apiCode: 'INTERNAL_SERVER_ERROR',
      },
    ]);
  });

  it.each([
    [
      { errors: [{ status: '401', code: 'UNAUTHORIZED' }] },
      200,
      401,
      'UNAUTHORIZED',
    ],
    [{ errors: [{ code: 'UNAUTHORIZED' }] }, 200, 401, 'UNAUTHORIZED'],
    [{ errors: [{ status: 200, code: 'NOT_FOUND' }] }, 200, 404, 'NOT_FOUND'],
    [
      { errors: [{ status: 'invalid', code: 'FORBIDDEN' }] },
      200,
      403,
      'FORBIDDEN',
    ],
    [{ errors: [{ status: 999, code: 'FORBIDDEN' }] }, 200, 403, 'FORBIDDEN'],
    [
      { error: { code: 'unauthorized', message: 'do not print' } },
      401,
      401,
      'unauthorized',
    ],
    [{ errors: ['private-value'] }, 200, 500, 'API_ERROR'],
    [{ errors: [null] }, 200, 500, 'API_ERROR'],
    [{ errors: [{ code: 'private-value' }] }, 503, 503, 'API_ERROR'],
    [{ error: [] }, 200, 500, 'API_ERROR'],
  ])(
    'rejects provider errors independently of HTTP success (%j)',
    async (body, httpStatus, apiStatus, code) => {
      const client = new SpatiusApiClient(
        'https://api.example.test',
        vi.fn(async () => json(body, httpStatus)),
      );
      await expect(client.listApps('private-value')).rejects.toMatchObject({
        status: apiStatus,
        httpStatus,
        apiCode: code,
      });
    },
  );

  it('refreshes and retries when a console list returns HTTP 200 with API 401', async () => {
    const requests: Request[] = [];
    const client = new SpatiusApiClient(
      'https://api.example.test',
      async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith('token:refresh')) {
          return json({ token: { accessToken: 'renewed-access' } });
        }
        if (request.headers.get('Authorization') === 'Bearer old-access') {
          return json({ errors: [{ code: 'UNAUTHORIZED', status: 401 }] });
        }
        return json({ apps: [{ appId: 'app-1', name: 'App' }] });
      },
    );
    const session = new SpatiusAuthenticatedSession(client, {
      accessToken: 'old-access',
      refreshToken: 'private-refresh',
    });
    await expect(
      session.authorized((token) => client.listApps(token)),
    ).resolves.toEqual([{ appId: 'app-1', name: 'App' }]);
    expect(requests).toHaveLength(3);
  });

  it('never exposes unknown error fields, secrets, or resource IDs in diagnostics', async () => {
    const secret = 'distinctive-private-payload';
    const events: SpatiusRequestDiagnostic[] = [];
    const client = new SpatiusApiClient(
      'https://api.example.test',
      vi.fn(async () =>
        json({
          errors: [
            {
              status: 500,
              code: secret,
              detail: secret,
              title: secret,
              source: { pointer: secret },
              meta: { token: secret },
            },
          ],
        }),
      ),
      (event) => events.push(event),
    );
    const error = await client
      .listApiKeys(secret, secret)
      .catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(events[0]?.route).toBe('/v1/apps/{appId}/api-keys');
  });

  it('logs transport and decoding failures without response text or nested causes', async () => {
    const secret = 'distinctive-unparseable-secret';
    for (const [mockFetch, expectedOutcome] of [
      [vi.fn(async () => Promise.reject(new Error(secret))), 'network-error'],
      [vi.fn(async () => new Response(secret)), 'invalid-response'],
      [
        vi.fn(async () => new Response(secret, { status: 502 })),
        'invalid-response',
      ],
    ] as const) {
      const events: SpatiusRequestDiagnostic[] = [];
      const client = new SpatiusApiClient(
        'https://api.example.test',
        mockFetch,
        (event) => events.push(event),
      );
      const error = await client
        .listApps(secret)
        .catch((caught: unknown) => caught);
      expect(String(error)).not.toContain(secret);
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(events[0]?.outcome).toBe(expectedOutcome);
    }
  });

  it('accepts successful empty error lists and bodyless revocation', async () => {
    const events: SpatiusRequestDiagnostic[] = [];
    const client = new SpatiusApiClient(
      'https://api.example.test',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ apps: [], errors: [] }))
        .mockResolvedValueOnce(new Response(''))
        .mockResolvedValueOnce(new Response(null, { status: 204 })),
      (event) => events.push(event),
    );
    await expect(client.listApps('token')).resolves.toEqual([]);
    await expect(
      client.revoke({ accessToken: 'access', refreshToken: 'refresh' }),
    ).resolves.toBeUndefined();
    await expect(
      client.revoke({ accessToken: 'access', refreshToken: 'refresh' }),
    ).resolves.toBeUndefined();
    expect(events.map((event) => event.httpStatus)).toEqual([200, 200, 204]);
  });
});

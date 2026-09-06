import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { SecretRedactor } from '../../src/setup/redaction.js';
import {
  createLoopbackCallbackServer,
  createPkceMaterial,
  loginToSpatius,
  type SpatiusCallbackServer,
  validateSpatiusCallback,
} from '../../src/setup/spatius-auth.js';
import {
  SpatiusApiClient,
  SpatiusAuthenticatedSession,
} from '../../src/setup/spatius-api.js';

describe('Spatius PKCE and callback validation', () => {
  it('creates an S256 challenge from a cryptographically sized verifier', () => {
    let fill = 0;
    const material = createPkceMaterial((size) => {
      fill += 1;
      return Buffer.alloc(size, fill);
    });
    const expected = createHash('sha256')
      .update(material.verifier)
      .digest('base64url');

    expect(material.challenge).toBe(expected);
    expect(material.verifier).not.toContain('=');
    expect(material.state).not.toBe(material.verifier);
    expect(material.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('accepts only the expected path, state, request ID, and code', () => {
    const redirect = 'http://127.0.0.1:1234/callback';
    expect(
      validateSpatiusCallback(
        '/callback?state=state&auth_request_id=request&auth_code=code',
        redirect,
        'state',
        'request',
      ),
    ).toEqual({ authCode: 'code', authRequestId: 'request' });

    for (const [url, message] of [
      ['/wrong?state=state', 'unexpected path'],
      ['/callback?error=access_denied', 'declined'],
      ['/callback?error=%21%21%21', 'declined'],
      ['/callback?error=%3Cscript%3E&error_description=secret', 'declined'],
      ['/callback?state=wrong&auth_request_id=request&auth_code=code', 'state'],
      [
        '/callback?state=state&auth_request_id=wrong&auth_code=code',
        'request ID',
      ],
      ['/callback?state=state&auth_request_id=request', 'authorization code'],
    ]) {
      expect(() =>
        validateSpatiusCallback(url!, redirect, 'state', 'request'),
      ).toThrow(message);
    }
  });
});

describe('Spatius loopback callback server', () => {
  it('binds to loopback, ignores unrelated paths, and returns a branded success page', async () => {
    const server = await createLoopbackCallbackServer();
    expect(server.redirectUri).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/u,
    );
    const waiting = server.waitForCallback({
      expectedRequestId: 'request',
      expectedState: 'state',
      timeoutMs: 1000,
    });
    const unrelated = await fetch(new URL('/other', server.redirectUri));
    expect(unrelated.status).toBe(404);
    const response = await fetch(
      `${server.redirectUri}?state=state&auth_request_id=request&auth_code=code`,
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Authorization complete');
    expect(html).toContain('Continue in your terminal');
    expect(html).not.toContain('create-spatius-app');
    expect(html).not.toContain('Real-time avatars. Human connections.');
    expect(html.match(/class="external-icon"/gu)).toHaveLength(4);
    expect(
      html.match(/class="link-label"><svg aria-hidden="true"/gu),
    ).toHaveLength(4);
    for (const href of [
      'https://www.spatius.ai/',
      'https://docs.spatius.ai/',
      'https://app.spatius.ai',
      'https://github.com/spatius-ai',
      'https://discord.gg/9HGhZfHZh9',
    ]) {
      expect(html).toContain(
        `href="${href}" target="_blank" rel="noopener noreferrer"`,
      );
    }
    expect(html).not.toMatch(
      /<script|<iframe|<img|auth_code=|auth_request_id=/u,
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    await expect(waiting).resolves.toEqual({
      authCode: 'code',
      authRequestId: 'request',
    });
    await server.close();
  });

  it('rejects invalid callbacks and timeouts without reflecting parameters', async () => {
    const invalidServer = await createLoopbackCallbackServer();
    const waiting = invalidServer.waitForCallback({
      expectedRequestId: 'request',
      expectedState: 'state',
      timeoutMs: 1000,
    });
    const rejected = expect(waiting).rejects.toThrow(/state/u);
    const response = await fetch(
      `${invalidServer.redirectUri}?state=wrong&auth_request_id=request&auth_code=distinctive-secret`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('distinctive-secret');
    await rejected;
    await invalidServer.close();

    const timeoutServer = await createLoopbackCallbackServer();
    await expect(
      timeoutServer.waitForCallback({
        expectedRequestId: 'request',
        expectedState: 'state',
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/Timed out/u);
    await timeoutServer.close();
  });

  it('rejects a second concurrent waiter', async () => {
    const server = await createLoopbackCallbackServer();
    const first = server.waitForCallback({
      expectedRequestId: 'request',
      expectedState: 'state',
      timeoutMs: 20,
    });
    await expect(
      server.waitForCallback({
        expectedRequestId: 'request',
        expectedState: 'state',
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/already pending/u);
    await expect(first).rejects.toThrow(/Timed out/u);
    await server.close();
  });
});

describe('Spatius browser login', () => {
  function callbackServer(
    options: {
      close?: () => Promise<void>;
      wait?: SpatiusCallbackServer['waitForCallback'];
    } = {},
  ): SpatiusCallbackServer {
    return {
      close: options.close ?? (async () => undefined),
      redirectUri: 'http://127.0.0.1:1234/callback',
      waitForCallback:
        options.wait ??
        (async () => ({ authCode: 'auth-code', authRequestId: 'request-1' })),
    };
  }

  it('prints the fallback URL, tolerates browser failure, exchanges, and returns a session', async () => {
    const redactor = new SecretRedactor();
    const onUrl = vi.fn();
    const onBrowserFailure = vi.fn();
    const close = vi.fn(async () => undefined);
    const revoke = vi.fn(async () => undefined);
    let callbackWaitStarted = false;
    const wait = vi.fn<SpatiusCallbackServer['waitForCallback']>(async () => {
      callbackWaitStarted = true;
      return { authCode: 'auth-code', authRequestId: 'request-1' };
    });
    const client = {
      createAuthSession: vi.fn(async () => ({
        authRequestId: 'request-1',
        authorizeUrl: 'https://app.spatius.ai/cli/auth/request-1',
        expiresIn: 60,
      })),
      exchangeAuthCode: vi.fn(async () => ({
        accessToken: 'distinctive-access-token',
        refreshToken: 'distinctive-refresh-token',
      })),
      refresh: vi.fn(),
      revoke,
    } as unknown as SpatiusApiClient;

    const session = await loginToSpatius({
      callbackServerFactory: async () => callbackServer({ close, wait }),
      client,
      onAuthorizationUrl: onUrl,
      onBrowserOpenFailure: onBrowserFailure,
      openBrowser: async () => {
        expect(callbackWaitStarted).toBe(true);
        throw new Error('no browser');
      },
      redactor,
    });

    expect(session).toBeInstanceOf(SpatiusAuthenticatedSession);
    expect(onUrl).toHaveBeenCalledWith(
      'https://app.spatius.ai/cli/auth/request-1',
    );
    expect(onBrowserFailure).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(
      redactor.redact(
        'distinctive-access-token distinctive-refresh-token auth-code',
      ),
    ).not.toMatch(/distinctive|auth-code/u);
    await session.revoke();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it.each([
    { message: 'authorization declined', browserFails: false },
    { message: 'callback timed out', browserFails: true },
  ])(
    'handles $message while the browser launcher is still pending',
    async ({ message, browserFails }) => {
      const callbackError = new Error(message);
      const close = vi.fn(async () => undefined);
      const exchange = vi.fn();
      const onBrowserOpenFailure = vi.fn();
      const onUnhandled = vi.fn();
      const client = {
        createAuthSession: vi.fn(async () => ({
          authRequestId: 'request-1',
          authorizeUrl: 'https://app.spatius.ai/auth',
        })),
        exchangeAuthCode: exchange,
      } as unknown as SpatiusApiClient;

      process.on('unhandledRejection', onUnhandled);
      try {
        await expect(
          loginToSpatius({
            callbackServerFactory: async () =>
              callbackServer({
                close,
                wait: () => Promise.reject(callbackError),
              }),
            client,
            onAuthorizationUrl: () => undefined,
            onBrowserOpenFailure,
            openBrowser: async () => {
              // Give Node a full event-loop turn to detect an unowned rejection.
              await new Promise<void>((resolvePromise) =>
                setImmediate(resolvePromise),
              );
              if (browserFails) throw new Error('browser launcher failed');
            },
          }),
        ).rejects.toBe(callbackError);

        expect(onUnhandled).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
        expect(exchange).not.toHaveBeenCalled();
        expect(onBrowserOpenFailure).toHaveBeenCalledTimes(
          browserFails ? 1 : 0,
        );
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    },
  );

  it('caps callback waiting by server expiry and always closes on failure', async () => {
    const close = vi.fn(async () => undefined);
    const wait = vi.fn<SpatiusCallbackServer['waitForCallback']>(async () =>
      Promise.reject(new Error('timed out')),
    );
    const client = {
      createAuthSession: vi.fn(async () => ({
        authRequestId: 'request-1',
        authorizeUrl: 'https://app.spatius.ai/auth',
        expiresAt: new Date(10_001).toISOString(),
        expiresIn: 30,
      })),
    } as unknown as SpatiusApiClient;

    await expect(
      loginToSpatius({
        callbackServerFactory: async () => callbackServer({ close, wait }),
        client,
        maximumWaitMs: 60_000,
        now: () => 10_000,
        onAuthorizationUrl: () => undefined,
        openBrowser: async () => undefined,
      }),
    ).rejects.toThrow(/timed out/u);
    expect(wait).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 1 }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the callback server when session creation or URL validation fails', async () => {
    for (const createAuthSession of [
      vi.fn(async () => Promise.reject(new Error('API unavailable'))),
      vi.fn(async () => ({
        authRequestId: 'request',
        authorizeUrl: 'not a URL',
      })),
      vi.fn(async () => ({
        authRequestId: 'request',
        authorizeUrl: 'file:///tmp/not-safe',
      })),
    ]) {
      const close = vi.fn(async () => undefined);
      const client = { createAuthSession } as unknown as SpatiusApiClient;
      await expect(
        loginToSpatius({
          callbackServerFactory: async () => callbackServer({ close }),
          client,
          onAuthorizationUrl: () => undefined,
          openBrowser: async () => undefined,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(close).toHaveBeenCalledOnce();
    }
  });
});

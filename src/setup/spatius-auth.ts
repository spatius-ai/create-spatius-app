import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';

import { SecretRedactor } from './redaction.js';
import { successPage } from './success-page.js';
import {
  SpatiusApiClient,
  SpatiusAuthenticatedSession,
} from './spatius-api.js';

const execFileAsync = promisify(execFile);
const callbackPath = '/callback';

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

export interface PkceMaterial {
  challenge: string;
  state: string;
  verifier: string;
}

export function createPkceMaterial(
  random: (size: number) => Buffer = randomBytes,
): PkceMaterial {
  const verifier = base64Url(random(32));
  return {
    challenge: base64Url(createHash('sha256').update(verifier).digest()),
    state: base64Url(random(18)),
    verifier,
  };
}

export interface SpatiusCallbackResult {
  authCode: string;
  authRequestId: string;
}

export function validateSpatiusCallback(
  requestUrl: string,
  redirectUri: string,
  expectedState: string,
  expectedRequestId: string,
): SpatiusCallbackResult {
  const url = new URL(requestUrl, redirectUri);
  if (url.pathname !== callbackPath) {
    throw new Error('The Spatius callback used an unexpected path.');
  }

  const providerError = url.searchParams.get('error');
  if (providerError !== null) {
    const safeCode = providerError.replace(/[^A-Za-z\d_.-]/gu, '').slice(0, 80);
    throw new Error(
      safeCode === ''
        ? 'Spatius authorization was declined.'
        : `Spatius authorization was declined (${safeCode}).`,
    );
  }

  if (url.searchParams.get('state') !== expectedState) {
    throw new Error('The Spatius callback state did not match.');
  }
  const authRequestId = url.searchParams.get('auth_request_id')?.trim();
  if (authRequestId !== expectedRequestId) {
    throw new Error('The Spatius callback request ID did not match.');
  }
  const authCode = url.searchParams.get('auth_code')?.trim();
  if (authCode === undefined || authCode === '') {
    throw new Error(
      'The Spatius callback did not include an authorization code.',
    );
  }

  return { authCode, authRequestId };
}

interface CallbackExpectation {
  expectedRequestId: string;
  expectedState: string;
  reject: (error: Error) => void;
  resolve: (result: SpatiusCallbackResult) => void;
}

export interface SpatiusCallbackServer {
  close(): Promise<void>;
  redirectUri: string;
  waitForCallback(options: {
    expectedRequestId: string;
    expectedState: string;
    timeoutMs: number;
  }): Promise<SpatiusCallbackResult>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.close(() => resolvePromise());
    server.closeAllConnections();
  });
}

export async function createLoopbackCallbackServer(): Promise<SpatiusCallbackServer> {
  let expectation: CallbackExpectation | undefined;
  let redirectUri = '';
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url === undefined) {
      response.writeHead(404).end('Not found');
      return;
    }
    const requestUrl = new URL(request.url, redirectUri);
    if (requestUrl.pathname !== callbackPath || expectation === undefined) {
      response.writeHead(404).end('Not found');
      return;
    }

    const current = expectation;
    expectation = undefined;
    try {
      const result = validateSpatiusCallback(
        request.url,
        redirectUri,
        current.expectedState,
        current.expectedRequestId,
      );
      response
        .writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'",
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
        })
        .end(successPage);
      current.resolve(result);
    } catch (error) {
      response
        .writeHead(400, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        })
        .end('Authorization could not be completed. Return to the terminal.');
      current.reject(
        error instanceof Error
          ? error
          : new Error('The Spatius callback was invalid.'),
      );
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
  const address = server.address() as AddressInfo;
  redirectUri = `http://127.0.0.1:${String(address.port)}${callbackPath}`;

  return {
    close: () => closeServer(server),
    redirectUri,
    waitForCallback: ({ expectedRequestId, expectedState, timeoutMs }) =>
      new Promise((resolvePromise, reject) => {
        if (expectation !== undefined) {
          reject(new Error('A Spatius callback is already pending.'));
          return;
        }
        const timeout = setTimeout(() => {
          expectation = undefined;
          reject(new Error('Timed out waiting for Spatius authorization.'));
        }, timeoutMs);
        expectation = {
          expectedRequestId,
          expectedState,
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          resolve: (result) => {
            clearTimeout(timeout);
            resolvePromise(result);
          },
        };
      }),
  };
}

export async function openSystemBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32.exe'
        : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    await execFileAsync(command, args, {
      timeout: 10_000,
      windowsHide: true,
    });
  } catch {
    throw new Error('The browser could not be opened automatically.');
  }
}

function sessionTimeoutMs(
  response: { expiresAt?: string; expiresIn?: number },
  now: () => number,
  maximumMs: number,
): number {
  const candidates = [maximumMs];
  if (response.expiresIn !== undefined && response.expiresIn > 0) {
    candidates.push(response.expiresIn * 1000);
  }
  if (response.expiresAt !== undefined) {
    const expiresAt = Date.parse(response.expiresAt);
    if (Number.isFinite(expiresAt)) {
      candidates.push(Math.max(1, expiresAt - now()));
    }
  }
  return Math.max(1, Math.min(...candidates.filter((value) => value > 0)));
}

function validateAuthorizationUrl(value: string): string {
  const url = new URL(value);
  const loopbackHost = ['127.0.0.1', '[::1]', 'localhost'].includes(
    url.hostname,
  );
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && loopbackHost)) ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('Spatius returned an unsafe authorization URL.');
  }
  return value;
}

interface LoginToSpatiusOptions {
  callbackServerFactory?: () => Promise<SpatiusCallbackServer>;
  client: SpatiusApiClient;
  maximumWaitMs?: number;
  now?: () => number;
  onAuthorizationUrl: (url: string) => void;
  onBrowserOpenFailure?: (error: Error) => void;
  openBrowser?: (url: string) => Promise<void>;
  redactor?: SecretRedactor;
}

export async function loginToSpatius({
  callbackServerFactory = createLoopbackCallbackServer,
  client,
  maximumWaitMs = 5 * 60_000,
  now = Date.now,
  onAuthorizationUrl,
  onBrowserOpenFailure,
  openBrowser = openSystemBrowser,
  redactor = new SecretRedactor(),
}: LoginToSpatiusOptions): Promise<SpatiusAuthenticatedSession> {
  const callback = await callbackServerFactory();
  const pkce = createPkceMaterial();
  redactor.add(pkce.verifier, pkce.state);

  try {
    const auth = await client.createAuthSession({
      codeChallenge: pkce.challenge,
      redirectUri: callback.redirectUri,
      state: pkce.state,
    });
    const authorizationUrl = validateAuthorizationUrl(auth.authorizeUrl);
    onAuthorizationUrl(authorizationUrl);
    const callbackResult = callback.waitForCallback({
      expectedRequestId: auth.authRequestId,
      expectedState: pkce.state,
      timeoutMs: sessionTimeoutMs(auth, now, maximumWaitMs),
    });
    // The callback can reject while the browser launcher is still pending.
    // Handle it immediately; awaiting the original promise below still throws.
    void callbackResult.catch(() => undefined);
    try {
      await openBrowser(authorizationUrl);
    } catch (error) {
      onBrowserOpenFailure?.(
        error instanceof Error
          ? error
          : new Error('The browser could not be opened automatically.'),
      );
    }

    const result = await callbackResult;
    redactor.add(result.authCode);
    const tokens = await client.exchangeAuthCode({
      authCode: result.authCode,
      authRequestId: result.authRequestId,
      codeVerifier: pkce.verifier,
    });
    redactor.add(tokens.accessToken, tokens.refreshToken);
    return new SpatiusAuthenticatedSession(client, tokens);
  } finally {
    await callback.close().catch(() => undefined);
  }
}

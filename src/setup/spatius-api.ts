export const SPATIUS_CONSOLE_BASE_URL = 'https://api.studio.spatius.ai';

export interface SpatiusAuthSessionResponse {
  authRequestId: string;
  authorizeUrl: string;
  expiresAt?: string;
  expiresIn?: number;
}

export interface SpatiusTokenSet {
  accessToken: string;
  refreshToken: string;
}

export interface SpatiusApp {
  appId: string;
  createdAt?: string;
  name: string;
}

export interface SpatiusApiKey {
  apiKey: string;
  createdAt?: string;
}

export interface SpatiusAvatar {
  backgroundUrl?: string;
  id: string;
  name: string;
  source: 'personal' | 'public';
}

export interface SpatiusRequestDiagnostic {
  method: string;
  route: string;
  durationMs: number;
  outcome: 'response' | 'network-error' | 'invalid-response';
  httpStatus?: number;
  apiStatus?: number;
  apiCode?: string;
}

const knownApiStatuses: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  INVALID_ARGUMENT: 400,
  FAILED_PRECONDITION: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  ALREADY_EXISTS: 409,
  FAILED_DEPENDENCY: 424,
  QUOTA_EXCEEDED: 429,
  INTERNAL_SERVER_ERROR: 500,
  UNIMPLEMENTED: 501,
  UNAVAILABLE: 503,
  unauthorized: 401,
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  internal_error: 500,
};

function diagnosticRoute(path: string): string {
  return path.replace(/\/apps\/[^/]+/u, '/apps/{appId}');
}

export class SpatiusHttpError extends Error {
  readonly status: number;
  readonly httpStatus: number;
  readonly apiCode?: string;

  constructor(
    status: number,
    method: string,
    path: string,
    options: {
      httpStatus?: number;
      apiCode?: string;
      missingFrontendUrl?: boolean;
    } = {},
  ) {
    const httpStatus = options.httpStatus ?? status;
    super(
      `Spatius request ${method} ${diagnosticRoute(path)} failed (HTTP ${String(httpStatus)}${options.apiCode === undefined ? '' : `, API ${String(status)} ${options.apiCode}`}).` +
        (options.missingFrontendUrl === true
          ? ' The Spatius console server is missing SERVER_OPEN_PLATFORM_FRONTEND_URL. Configure it with the Studio URL in the console deployment, then retry.'
          : ''),
    );
    this.name = 'SpatiusHttpError';
    this.status = status;
    this.httpStatus = httpStatus;
    this.apiCode = options.apiCode;
  }
}

type JsonObject = Record<string, unknown>;

function apiError(
  payload: JsonObject,
  httpStatus: number,
  method: string,
  path: string,
): SpatiusHttpError | undefined {
  const errors = payload.errors;
  const hasErrors = Array.isArray(errors) && errors.length > 0;
  const raw: unknown = hasErrors ? errors[0] : payload.error;
  if (!hasErrors && (raw === undefined || raw === null)) return undefined;
  const error =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as JsonObject)
      : {};
  // Only known codes and an exact, known-safe configuration message may leave
  // the client. Arbitrary details, titles, source fields, and bodies can echo secrets.
  const code =
    typeof error.code === 'string' &&
    Object.hasOwn(knownApiStatuses, error.code)
      ? error.code
      : 'API_ERROR';
  const suppliedStatus =
    typeof error.status === 'number'
      ? error.status
      : typeof error.status === 'string' && /^\d{3}$/u.test(error.status)
        ? Number(error.status)
        : undefined;
  const status =
    suppliedStatus !== undefined &&
    Number.isInteger(suppliedStatus) &&
    suppliedStatus >= 400 &&
    suppliedStatus <= 599
      ? suppliedStatus
      : (knownApiStatuses[code] ?? (httpStatus >= 400 ? httpStatus : 500));

  return new SpatiusHttpError(status, method, path, {
    apiCode: code,
    httpStatus,
    missingFrontendUrl:
      code === 'INTERNAL_SERVER_ERROR' &&
      error.detail === 'server open-platform frontend URL is not configured',
  });
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Spatius returned an invalid ${label} response.`);
  }
  return value as JsonObject;
}

function field(
  value: JsonObject,
  camelCase: string,
  snakeCase: string,
): unknown {
  return value[camelCase] ?? value[snakeCase];
}

function requiredString(
  value: JsonObject,
  camelCase: string,
  snakeCase = camelCase,
): string {
  const result = field(value, camelCase, snakeCase);
  if (typeof result !== 'string' || result.trim() === '') {
    throw new Error(`Spatius returned a response without ${camelCase}.`);
  }
  return result.trim();
}

function optionalString(
  value: JsonObject,
  camelCase: string,
  snakeCase = camelCase,
): string | undefined {
  const result = field(value, camelCase, snakeCase);
  return typeof result === 'string' && result.trim() !== ''
    ? result.trim()
    : undefined;
}

function optionalNumber(
  value: JsonObject,
  camelCase: string,
  snakeCase = camelCase,
): number | undefined {
  const result = field(value, camelCase, snakeCase);
  return typeof result === 'number' && Number.isFinite(result)
    ? result
    : undefined;
}

function arrayField(
  value: JsonObject,
  camelCase: string,
  snakeCase: string,
): unknown[] {
  const result = field(value, camelCase, snakeCase);
  if (!Array.isArray(result)) return [];
  const values: unknown[] = [];
  for (const entry of result) values.push(entry as unknown);
  return values;
}

function nextPageToken(value: JsonObject): string | undefined {
  const paginationValue = value.pagination;
  if (
    paginationValue === null ||
    typeof paginationValue !== 'object' ||
    Array.isArray(paginationValue)
  ) {
    return undefined;
  }
  return optionalString(
    paginationValue as JsonObject,
    'nextPageToken',
    'next_page_token',
  );
}

interface RequestOptions {
  accessToken?: string;
  appCredentials?: { apiKey: string; appId: string };
  body?: JsonObject;
  method?: 'GET' | 'POST';
  query?: URLSearchParams;
}

export class SpatiusApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #onDiagnostic?: (event: SpatiusRequestDiagnostic) => void;

  constructor(
    baseUrl = SPATIUS_CONSOLE_BASE_URL,
    fetchImplementation: typeof fetch = fetch,
    onDiagnostic?: (event: SpatiusRequestDiagnostic) => void,
  ) {
    this.#baseUrl = baseUrl.replace(/\/+$/u, '');
    this.#fetch = fetchImplementation;
    this.#onDiagnostic = onDiagnostic;
  }

  async #request(
    path: string,
    {
      accessToken,
      appCredentials,
      body,
      method = 'GET',
      query,
    }: RequestOptions = {},
  ): Promise<JsonObject> {
    const startedAt = performance.now();
    const report = (
      details: Pick<
        SpatiusRequestDiagnostic,
        'outcome' | 'httpStatus' | 'apiStatus' | 'apiCode'
      >,
    ) => {
      this.#onDiagnostic?.({
        method,
        route: diagnosticRoute(path),
        durationMs: Math.round(performance.now() - startedAt),
        ...details,
      });
    };
    const url = new URL(`${this.#baseUrl}${path}`);
    if (query !== undefined) {
      url.search = query.toString();
    }
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (accessToken !== undefined) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    if (appCredentials !== undefined) {
      headers.set('X-App-ID', appCredentials.appId);
      headers.set('X-API-Key', appCredentials.apiKey);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers,
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      report({ outcome: 'network-error' });
      throw new Error(
        `Could not reach the Spatius API for ${method} ${diagnosticRoute(path)}.`,
      );
    }

    if (response.status === 204) {
      report({ outcome: 'response', httpStatus: response.status });
      return {};
    }

    let payload: JsonObject;
    try {
      const contents = await response.text();
      payload =
        contents.trim() === '' ? {} : object(JSON.parse(contents), 'API');
    } catch {
      report({ outcome: 'invalid-response', httpStatus: response.status });
      if (!response.ok)
        throw new SpatiusHttpError(response.status, method, path);
      throw new Error(
        `Spatius returned an invalid JSON object response for ${method} ${diagnosticRoute(path)}.`,
      );
    }

    const error = apiError(payload, response.status, method, path);
    report({
      outcome: 'response',
      httpStatus: response.status,
      ...(error === undefined
        ? {}
        : { apiStatus: error.status, apiCode: error.apiCode }),
    });
    if (error !== undefined) throw error;
    if (!response.ok) throw new SpatiusHttpError(response.status, method, path);
    return payload;
  }

  async createAuthSession(input: {
    codeChallenge: string;
    redirectUri: string;
    state: string;
  }): Promise<SpatiusAuthSessionResponse> {
    const response = await this.#request('/v1/cli/auth/sessions', {
      body: {
        clientName: 'create-spatius-app',
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: 'CLI_AUTH_CODE_CHALLENGE_METHOD_S256',
        redirectUri: input.redirectUri,
        state: input.state,
      },
      method: 'POST',
    });
    return {
      authRequestId: requiredString(
        response,
        'authRequestId',
        'auth_request_id',
      ),
      authorizeUrl: requiredString(response, 'authorizeUrl', 'authorize_url'),
      ...(optionalString(response, 'expiresAt', 'expires_at') === undefined
        ? {}
        : { expiresAt: optionalString(response, 'expiresAt', 'expires_at') }),
      ...(optionalNumber(response, 'expiresIn', 'expires_in') === undefined
        ? {}
        : { expiresIn: optionalNumber(response, 'expiresIn', 'expires_in') }),
    };
  }

  async exchangeAuthCode(input: {
    authCode: string;
    authRequestId: string;
    codeVerifier: string;
  }): Promise<SpatiusTokenSet> {
    const response = await this.#request('/v1/cli/auth/token', {
      body: {
        authCode: input.authCode,
        authRequestId: input.authRequestId,
        codeVerifier: input.codeVerifier,
      },
      method: 'POST',
    });
    return parseTokenSet(object(response.token, 'token'));
  }

  async refresh(refreshToken: string): Promise<SpatiusTokenSet> {
    const response = await this.#request('/v1/cli/auth/token:refresh', {
      body: { refreshToken },
      method: 'POST',
    });
    return parseTokenSet(object(response.token, 'token'), refreshToken);
  }

  async revoke(tokens: SpatiusTokenSet): Promise<void> {
    await this.#request('/v1/cli/auth/token:revoke', {
      body: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      method: 'POST',
    });
  }

  async listApps(accessToken: string): Promise<SpatiusApp[]> {
    const results: SpatiusApp[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ 'pagination.pageSize': '100' });
      if (pageToken !== undefined) {
        query.set('pagination.pageToken', pageToken);
      }
      const response = await this.#request('/v1/apps', {
        accessToken,
        query,
      });
      for (const raw of arrayField(response, 'apps', 'apps')) {
        const app = object(raw, 'app');
        results.push({
          appId: requiredString(app, 'appId', 'app_id'),
          ...(optionalString(app, 'createdAt', 'created_at') === undefined
            ? {}
            : { createdAt: optionalString(app, 'createdAt', 'created_at') }),
          name: optionalString(app, 'name') ?? 'Unnamed app',
        });
      }
      pageToken = nextPageToken(response);
      if (pageToken !== undefined && seen.has(pageToken)) break;
      if (pageToken !== undefined) seen.add(pageToken);
    } while (pageToken !== undefined);

    return results;
  }

  async createApp(accessToken: string, name: string): Promise<SpatiusApp> {
    const response = await this.#request('/v1/apps', {
      accessToken,
      body: { name },
      method: 'POST',
    });
    return {
      appId: requiredString(response, 'appId', 'app_id'),
      name,
    };
  }

  async listApiKeys(
    accessToken: string,
    appId: string,
  ): Promise<SpatiusApiKey[]> {
    const results: SpatiusApiKey[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ 'pagination.pageSize': '100' });
      if (pageToken !== undefined) {
        query.set('pagination.pageToken', pageToken);
      }
      const path = `/v1/apps/${encodeURIComponent(appId)}/api-keys`;
      const response = await this.#request(path, { accessToken, query });
      for (const raw of arrayField(response, 'apiKeys', 'api_keys')) {
        results.push(parseApiKey(object(raw, 'API key')));
      }
      pageToken = nextPageToken(response);
      if (pageToken !== undefined && seen.has(pageToken)) break;
      if (pageToken !== undefined) seen.add(pageToken);
    } while (pageToken !== undefined);
    return results;
  }

  async createApiKey(
    accessToken: string,
    appId: string,
  ): Promise<SpatiusApiKey> {
    const path = `/v1/apps/${encodeURIComponent(appId)}/api-keys`;
    const response = await this.#request(path, {
      accessToken,
      body: { appId },
      method: 'POST',
    });
    return parseApiKey(object(field(response, 'apiKey', 'api_key'), 'API key'));
  }

  async listPublicAvatars(accessToken: string): Promise<SpatiusAvatar[]> {
    const results: SpatiusAvatar[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ 'pagination.pageSize': '100' });
      if (pageToken !== undefined) {
        query.set('pagination.pageToken', pageToken);
      }
      const response = await this.#request('/v2/console/public-avatars', {
        accessToken,
        query,
      });
      for (const raw of arrayField(
        response,
        'publicAvatars',
        'public_avatars',
      )) {
        const avatar = object(raw, 'public avatar');
        results.push({
          id: requiredString(avatar, 'id'),
          name: optionalString(avatar, 'name') ?? 'Unnamed avatar',
          source: 'public',
          backgroundUrl: optionalString(
            avatar,
            'backgroundImageUrl',
            'background_image_url',
          ),
        });
      }
      pageToken = nextPageToken(response);
      if (pageToken !== undefined && seen.has(pageToken)) break;
      if (pageToken !== undefined) seen.add(pageToken);
    } while (pageToken !== undefined);
    return results;
  }

  async listPersonalAvatars(
    appId: string,
    apiKey: string,
  ): Promise<SpatiusAvatar[]> {
    const results: SpatiusAvatar[] = [];
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ 'pagination.pageSize': '100' });
      if (pageToken !== undefined) {
        query.set('pagination.pageToken', pageToken);
      }
      const response = await this.#request('/v1/open/avatars', {
        appCredentials: { apiKey, appId },
        query,
      });
      for (const raw of arrayField(response, 'avatars', 'avatars')) {
        const avatar = object(raw, 'personal avatar');
        results.push({
          id: requiredString(avatar, 'id'),
          name: optionalString(avatar, 'name') ?? 'Unnamed avatar',
          source: 'personal',
        });
      }
      pageToken = nextPageToken(response);
      if (pageToken !== undefined && seen.has(pageToken)) break;
      if (pageToken !== undefined) seen.add(pageToken);
    } while (pageToken !== undefined);
    return results;
  }
}

function parseTokenSet(
  value: JsonObject,
  refreshTokenFallback?: string,
): SpatiusTokenSet {
  const refreshToken =
    optionalString(value, 'refreshToken', 'refresh_token') ??
    refreshTokenFallback;
  if (refreshToken === undefined) {
    throw new Error('Spatius returned a response without refreshToken.');
  }

  return {
    accessToken: requiredString(value, 'accessToken', 'access_token'),
    refreshToken,
  };
}

function parseApiKey(value: JsonObject): SpatiusApiKey {
  return {
    apiKey: requiredString(value, 'apiKey', 'api_key'),
    ...(optionalString(value, 'createdAt', 'created_at') === undefined
      ? {}
      : { createdAt: optionalString(value, 'createdAt', 'created_at') }),
  };
}

export class SpatiusAuthenticatedSession {
  readonly #client: SpatiusApiClient;
  #tokens: SpatiusTokenSet;

  constructor(client: SpatiusApiClient, tokens: SpatiusTokenSet) {
    this.#client = client;
    this.#tokens = tokens;
  }

  async authorized<Value>(
    operation: (accessToken: string) => Promise<Value>,
  ): Promise<Value> {
    try {
      return await operation(this.#tokens.accessToken);
    } catch (error) {
      if (!(error instanceof SpatiusHttpError) || error.status !== 401) {
        throw error;
      }
      this.#tokens = await this.#client.refresh(this.#tokens.refreshToken);
      return operation(this.#tokens.accessToken);
    }
  }

  revoke(): Promise<void> {
    return this.#client.revoke(this.#tokens);
  }
}

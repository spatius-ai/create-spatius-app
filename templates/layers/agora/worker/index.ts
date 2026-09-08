import {
  ConfigurationError,
  createAgoraSession,
  stopAgoraSession,
  type AgoraEnvironment,
} from './agora.js';
export async function handleRequest(
  request: Request,
  env: AgoraEnvironment,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (path === '/api/health')
    return request.method === 'GET'
      ? json({ ok: true })
      : json({ error: 'Method not allowed' }, 405);
  if (!['/api/session', '/api/session/stop'].includes(path))
    return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);
  try {
    if (path === '/api/session')
      return json(await createAgoraSession(env), 201);
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('capability' in body) ||
      typeof body.capability !== 'string'
    )
      return json({ error: 'Missing session authorization' }, 403);
    await stopAgoraSession(env, body.capability);
    return json({ ok: true });
  } catch (error) {
    return json(
      {
        error:
          error instanceof ConfigurationError
            ? 'Configure the Agora pipeline and Spatius credentials before starting.'
            : 'The session request failed. Please try again.',
      },
      error instanceof ConfigurationError
        ? 503
        : path.endsWith('/stop')
          ? 403
          : 502,
    );
  }
}

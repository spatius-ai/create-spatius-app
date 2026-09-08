import { ConfigurationError, createSession, stopSession } from './session.js';

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    headers: JSON_HEADERS,
    status,
  });
}

export async function handleRequest(
  request: Request,
  env: CloudflareBindings,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    return json({ ok: true });
  }

  if (url.pathname === '/api/session/stop') {
    if (request.method !== 'POST')
      return json({ error: 'Method not allowed.' }, 405);
    try {
      const body: { capability?: string } = await request.json();
      await stopSession(env, body.capability ?? '');
      return json({ ok: true });
    } catch {
      return json({ error: 'Could not stop this session.' }, 403);
    }
  }

  if (url.pathname === '/api/session') {
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    try {
      return json(await createSession(env), 201);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        console.error(
          'Session endpoint is not configured correctly:',
          error.message,
        );
        return json(
          {
            error:
              'The voice session service is not configured. Check the server environment.',
          },
          503,
        );
      }

      console.error('Could not create a voice session.');
      return json({ error: 'Could not create a voice session.' }, 500);
    }
  }

  return json({ error: 'Not found.' }, 404);
}

export default {
  fetch: handleRequest,
};

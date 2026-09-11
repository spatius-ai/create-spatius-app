import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const env: CloudflareBindings = {
  AGORA_APP_ID: 'a'.repeat(32),
  AGORA_APP_CERTIFICATE: 'b'.repeat(32),
  AGORA_PIPELINE_ID: 'test-pipeline',
  SPATIUS_API_KEY: 'private-key',
  SPATIUS_APP_ID: 'test-app',
  SPATIUS_AVATAR_ID: 'test-avatar',
  SPATIUS_REGION: 'cn-beijing',
  AGORA_AVATAR_SAMPLE_RATE: '24000',
};
const request = (path: string, method = 'GET', body?: object) =>
  new Request(`https://app.example${path}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
afterEach(() => vi.unstubAllGlobals());
describe('Cloudflare Agora API', () => {
  it('serves health and rejects unknown routes and unsupported methods', async () => {
    expect(
      await (await worker.fetch(request('/api/health'), env)).json(),
    ).toEqual({ ok: true });
    expect((await worker.fetch(request('/api/missing'), env)).status).toBe(404);
    expect((await worker.fetch(request('/api/session'), env)).status).toBe(405);
    expect(
      (await worker.fetch(request('/api/health', 'POST'), env)).status,
    ).toBe(405);
  });
  it('uses Worker bindings to create and stop hosted sessions without leaking secrets', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ agent_id: 'hosted-agent' }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch(request('/api/session', 'POST'), env);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const session = await response.json<{ capability: string }>();
    expect(JSON.stringify(session)).not.toContain(env.AGORA_APP_CERTIFICATE);
    expect(JSON.stringify(session)).not.toContain(env.SPATIUS_API_KEY);
    expect(
      (await worker.fetch(request('/api/session/stop', 'POST', session), env))
        .status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('fails missing configuration and invalid stop authorization before contacting Agora', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await worker.fetch(request('/api/session', 'POST'), {
          ...env,
          AGORA_APP_CERTIFICATE: '',
        })
      ).status,
    ).toBe(503);
    expect(
      (await worker.fetch(request('/api/session/stop', 'POST', {}), env))
        .status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

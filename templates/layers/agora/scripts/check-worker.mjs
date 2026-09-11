import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Miniflare } from 'miniflare';

// Run the production bundle in workerd, with all provider traffic mocked.
const root = resolve(import.meta.dirname, '..');
const deploymentPath = resolve(root, '.wrangler/deploy/config.json');
const deployment = JSON.parse(await readFile(deploymentPath, 'utf8'));
const configPath = resolve(dirname(deploymentPath), deployment.configPath);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const bindings = {
  ...config.vars,
  AGORA_APP_ID: 'a'.repeat(32),
  AGORA_APP_CERTIFICATE: 'b'.repeat(32),
  AGORA_PIPELINE_ID: 'test-pipeline',
  SPATIUS_APP_ID: 'test-app',
  SPATIUS_API_KEY: 'private-test-key',
  SPATIUS_AVATAR_ID: 'test-avatar',
};
const calls = [];
const outboundService = async (request) => {
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://api.agora.io');
  assert.equal(request.method, 'POST');
  assert.match(request.headers.get('authorization'), /^agora token=".+"$/);
  calls.push(url.pathname);
  if (url.pathname.endsWith('/join')) {
    const body = await request.json();
    assert.equal(body.pipeline_id, bindings.AGORA_PIPELINE_ID);
    assert.equal(
      body.properties.avatar.params.spatius_api_key,
      bindings.SPATIUS_API_KEY,
    );
    return Response.json({ agent_id: 'test-agent' });
  }
  assert.ok(url.pathname.endsWith('/agents/test-agent/leave'));
  return new Response(null, { status: 404 });
};
const worker = new Miniflare({
  workers: [
    {
      config: {
        name: config.name,
        type: 'worker',
        compatibilityDate: config.compatibility_date,
        compatibilityFlags: config.compatibility_flags,
        manifest: {
          mainModule: config.main,
          modulesRoot: dirname(configPath),
          modules: {
            [config.main]: {
              type: 'esm',
              contents: await readFile(
                resolve(dirname(configPath), config.main),
                'utf8',
              ),
            },
          },
        },
        env: Object.fromEntries(
          Object.entries(bindings).map(([name, value]) => [
            name,
            { type: 'text', value },
          ]),
        ),
      },
      dev: { outboundService: { type: 'fetcher', handler: outboundService } },
    },
  ],
});
try {
  const health = await worker.dispatchFetch('https://app.example/api/health');
  assert.deepEqual(await health.json(), { ok: true });
  const response = await worker.dispatchFetch(
    'https://app.example/api/session',
    { method: 'POST' },
  );
  assert.equal(response.status, 201, await response.clone().text());
  const session = await response.json();
  assert.equal(typeof session.token, 'string');
  assert.notEqual(session.uid, session.agentUid);
  assert.ok(!JSON.stringify(session).includes(bindings.SPATIUS_API_KEY));
  assert.ok(!JSON.stringify(session).includes(bindings.AGORA_APP_CERTIFICATE));
  const stop = (capability) =>
    worker.dispatchFetch('https://app.example/api/session/stop', {
      method: 'POST',
      body: JSON.stringify({ capability }),
    });
  assert.equal((await stop('invalid')).status, 403);
  assert.equal((await stop(session.capability)).status, 200);
  assert.equal(calls.length, 2);
  console.log(
    'Cloudflare Worker session startup and cleanup verified with mocked Agora.',
  );
} finally {
  await worker.dispose();
}

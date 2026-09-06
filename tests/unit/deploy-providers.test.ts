import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationRequired,
  createProviders,
  deploymentEnvironment,
  parseAgents,
  parseProjects,
  projectSubdomain,
} from '../../src/deploy/providers.js';
import {
  DeploymentCommandError,
  type DeploymentCommand,
} from '../../src/deploy/command.js';
import { SecretRedactor } from '../../src/setup/redaction.js';
import type { DeploymentState } from '../../src/deploy/state.js';
const state: DeploymentState = {
  version: 1,
  accountId: 'a'.repeat(32),
  workerName: 'app',
  projectName: 'Demo',
  subdomain: 'demo',
  region: 'us-east',
  agentId: 'CA_test',
  phase: 'prepared',
};
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
function fixture() {
  const run = vi.fn(async (_spec: DeploymentCommand) => '');
  const request = vi.fn<typeof fetch>();
  const sleep = vi.fn(async () => {});
  const controller = new AbortController();
  const redactor = new SecretRedactor();
  const providers = createProviders({
    root: '/project',
    manager: 'pnpm',
    run,
    request,
    sleep,
    signal: controller.signal,
    redactor,
  });
  return { providers, run, request, sleep, controller, redactor };
}
function agentJson(status = 'Running', version = 'v1') {
  return JSON.stringify({
    agents: [
      {
        agent_id: 'CA_test',
        version: 'v1',
        agent_deployments: [
          { region: 'us-east', agent_name: 'dispatch', status, version },
        ],
      },
    ],
  });
}
describe('provider adapters', () => {
  it('selects only LiveKit Cloud project URLs and never returns credentials', () => {
    const redactor = new SecretRedactor();
    const output = parseProjects(
      JSON.stringify([
        {
          Name: 'Demo',
          URL: 'wss://demo.livekit.cloud',
          APIKey: 'private-key',
          APISecret: 'private-secret',
        },
        { Name: 'Local', URL: 'http://localhost:7880' },
      ]),
      redactor,
    );
    expect(output).toEqual([{ name: 'Demo', subdomain: 'demo' }]);
    expect(redactor.redact('private-secret')).toBe('[REDACTED]');
    expect(parseProjects('', redactor)).toEqual([]);
    expect(() => parseProjects('{}', redactor)).toThrow();
    expect(projectSubdomain('https://demo.livekit.cloud')).toBe('demo');
    expect(() =>
      projectSubdomain('wss://demo.livekit.cloud.evil.test'),
    ).toThrow();
  });
  it('reads both protobuf naming styles and ignores staging deployments', () => {
    expect(parseAgents(agentJson())[0]).toMatchObject({
      id: 'CA_test',
      status: 'running',
      region: 'us-east',
    });
    expect(
      parseAgents(
        JSON.stringify({
          agents: [
            {
              agentId: 'CA_test',
              agentDeployments: [
                { agentName: 'dispatch', status: 'Running' },
                { deployment: 'staging' },
              ],
            },
          ],
        }),
      ),
    ).toHaveLength(1);
    expect(() => parseAgents('{"agents":[{}]}')).toThrow();
  });
  it('removes ambient provider target overrides while preserving authentication', () => {
    vi.stubEnv('LIVEKIT_API_SECRET', 'bad');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'bad');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
    expect(deploymentEnvironment(state.accountId)).toMatchObject({
      CLOUDFLARE_ACCOUNT_ID: state.accountId,
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_ENV: '',
    });
    expect(deploymentEnvironment()).not.toHaveProperty('LIVEKIT_API_SECRET');
    expect(deploymentEnvironment()).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID');
  });
  it('probes capabilities rather than assuming an executable is compatible', async () => {
    const f = fixture();
    f.run.mockResolvedValue('--secrets-file --json --yes');
    expect(await f.providers.probeWrangler()).toBe(true);
    expect(await f.providers.probeLiveKit()).toBe('ready');
    f.run.mockResolvedValue('');
    expect(await f.providers.probeWrangler()).toBe(false);
    expect(await f.providers.probeLiveKit()).toBe('incompatible');
    f.run.mockRejectedValue(new Error('missing'));
    expect(await f.providers.probeWrangler()).toBe(false);
    expect(await f.providers.probeLiveKit()).toBe('missing');
  });
  it('distinguishes expired authentication from network and permission errors', async () => {
    const f = fixture();
    f.run.mockResolvedValue(
      JSON.stringify({
        loggedIn: true,
        accounts: [{ id: state.accountId, name: 'Demo' }],
      }),
    );
    expect(await f.providers.accounts()).toHaveLength(1);
    f.run.mockRejectedValue(
      new DeploymentCommandError('exit 1', '{"loggedIn":false}'),
    );
    await expect(f.providers.accounts()).rejects.toBeInstanceOf(
      AuthenticationRequired,
    );
    f.run.mockRejectedValue(new Error('network'));
    await expect(f.providers.accounts()).rejects.toThrow('network');
    expect(f.run).not.toHaveBeenCalledWith(
      expect.objectContaining({ interactive: true }),
    );
  });
  it('runs login interactively and deployment with explicit project and account', async () => {
    const f = fixture();
    await f.providers.loginCloudflare();
    await f.providers.loginLiveKit();
    expect(f.run.mock.calls.filter(([s]) => s.interactive)).toHaveLength(2);
    await f.providers.deployAgent(state, '/private/agent.env', true);
    expect(f.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: [
          '--project',
          'Demo',
          '--yes',
          'agent',
          'create',
          '--secrets-file',
          '/private/agent.env',
          '--region',
          'us-east',
          '.',
        ],
        capture: false,
      }),
    );
    await f.providers.deployAgent(state, '/private/agent.env', false);
    expect(f.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['deploy']) as string[],
      }),
    );
    await f.providers.deployWorker(state, '/private/worker.json');
    expect(f.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          CLOUDFLARE_ACCOUNT_ID: state.accountId,
        }) as NodeJS.ProcessEnv,
        args: expect.arrayContaining([
          '--secrets-file',
          '/private/worker.json',
        ]) as string[],
      }),
    );
  });
  it('captures project and agent JSON without streaming it', async () => {
    const f = fixture();
    f.run.mockResolvedValue('[]');
    expect(await f.providers.projects()).toEqual([]);
    f.run.mockResolvedValue(agentJson());
    expect(await f.providers.agents('Demo')).toHaveLength(1);
    expect(f.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        capture: true,
        args: ['--project', 'Demo', '--yes', 'agent', 'list', '--json'],
      }),
    );
  });
  it('treats only the documented missing-script error as a new Worker', async () => {
    const f = fixture();
    f.run.mockResolvedValue('{"type":"oauth","token":"sensitive-token"}');
    f.request.mockResolvedValueOnce(
      Response.json(
        { success: false, errors: [{ code: 10007 }] },
        { status: 404 },
      ),
    );
    expect(await f.providers.workerExists(state.accountId, 'app')).toBe(false);
    f.request.mockResolvedValueOnce(
      Response.json({ success: false }, { status: 403 }),
    );
    await expect(
      f.providers.workerExists(state.accountId, 'app'),
    ).rejects.toThrow('HTTP 403');
    f.request.mockResolvedValueOnce(
      Response.json({ success: true, result: {} }),
    );
    expect(await f.providers.workerExists(state.accountId, 'app')).toBe(true);
    expect(f.redactor.redact('sensitive-token')).toBe('[REDACTED]');
    expect(f.request).toHaveBeenCalledWith(
      expect.stringContaining('/workers/scripts/app/settings'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer sensitive-token' },
        redirect: 'error',
      }),
    );
  });
  it('supports Wrangler key/email auth and rejects missing auth or workers.dev subdomain', async () => {
    const f = fixture();
    f.run.mockResolvedValue(
      '{"type":"api_key","key":"private-key","email":"x@example.com"}',
    );
    f.request.mockResolvedValueOnce(
      Response.json({ success: true, result: { subdomain: 'my-account' } }),
    );
    expect(await f.providers.workerUrl(state.accountId, 'app')).toBe(
      'https://app.my-account.workers.dev',
    );
    f.request.mockResolvedValueOnce(
      Response.json({ success: false }, { status: 404 }),
    );
    await expect(f.providers.workerUrl(state.accountId, 'app')).rejects.toThrow(
      'Enable a workers.dev',
    );
    f.run.mockResolvedValue('{}');
    await expect(f.providers.workerUrl(state.accountId, 'app')).rejects.toThrow(
      'authentication',
    );
  });
  it('waits for matching name, region, and rolled-out version', async () => {
    const f = fixture();
    f.run
      .mockResolvedValueOnce(agentJson('Running', 'old'))
      .mockResolvedValueOnce(agentJson('Deploying'))
      .mockResolvedValue(agentJson());
    await f.providers.waitForAgent(state, 'dispatch');
    expect(f.sleep).toHaveBeenCalledTimes(2);
    f.run.mockResolvedValue(agentJson('Failed'));
    await expect(f.providers.waitForAgent(state, 'dispatch')).rejects.toThrow(
      'agent failed',
    );
    f.run.mockResolvedValue(agentJson());
    await expect(f.providers.waitForAgent(state, 'different')).rejects.toThrow(
      'timed out',
    );
  });
  it('retries frontend/health failures and does not create sessions', async () => {
    const f = fixture();
    f.request
      .mockRejectedValueOnce(new Error('DNS'))
      .mockImplementation(async (url) =>
        new URL(url instanceof Request ? url.url : url).pathname ===
        '/api/health'
          ? Response.json({ ok: true })
          : new Response('<html>'),
      );
    await f.providers.verify('https://app.example.workers.dev');
    expect(f.sleep).toHaveBeenCalledOnce();
    expect(
      f.request.mock.calls.every(
        ([url]) =>
          !(url instanceof Request ? url.url : url.toString()).includes(
            '/api/session',
          ),
      ),
    ).toBe(true);
    f.request.mockImplementation(async () => Response.json({ ok: false }));
    await expect(
      f.providers.verify('https://app.example.workers.dev'),
    ).rejects.toThrow('HTTP verification failed');
    f.controller.abort();
    f.request.mockRejectedValue(new Error('aborted'));
    await expect(
      f.providers.verify('https://app.example.workers.dev'),
    ).rejects.toThrow('cancelled');
  });
  it('validates the Vite output target after building, before deployment', async () => {
    const f = fixture();
    const root = await mkdtemp(join(tmpdir(), 'deploy-build-'));
    roots.push(root);
    const providers = createProviders({
      root,
      manager: 'npm',
      run: f.run,
      request: f.request,
      signal: f.controller.signal,
      redactor: f.redactor,
    });
    await expect(providers.build(state)).rejects.toThrow('did not produce');
    await mkdir(join(root, '.wrangler/deploy'), { recursive: true });
    await mkdir(join(root, 'dist/worker'), { recursive: true });
    await writeFile(
      join(root, '.wrangler/deploy/config.json'),
      '{"configPath":"../../dist/worker/wrangler.json"}',
    );
    await writeFile(
      join(root, 'dist/worker/wrangler.json'),
      JSON.stringify({ name: 'other', account_id: state.accountId }),
    );
    await expect(providers.build(state)).rejects.toThrow('differs');
    await writeFile(
      join(root, 'dist/worker/wrangler.json'),
      JSON.stringify({ name: state.workerName, account_id: state.accountId }),
    );
    await providers.build(state);
    expect(f.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'npm', args: ['run', 'build'] }),
    );
  });
});

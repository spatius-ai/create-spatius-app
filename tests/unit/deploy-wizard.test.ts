import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDeployment } from '../../src/deploy/wizard.js';
import {
  deploymentFiles,
  loadState,
  saveState,
} from '../../src/deploy/state.js';
import type {
  DeploymentProviders,
  AgentStatus,
} from '../../src/deploy/providers.js';
import type { SetupPrompts } from '../../src/prompts.js';
import { PromptCancelledError } from '../../src/errors.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const accountId = 'a'.repeat(32);
const values =
  'LIVEKIT_URL=wss://demo.livekit.cloud\nLIVEKIT_API_KEY=livekit-key\nLIVEKIT_API_SECRET=livekit-secret\nLIVEKIT_AGENT_NAME=spatius-agent\nSPATIUS_APP_ID=spatius-app\nSPATIUS_AVATAR_ID=avatar-id\nCARTESIA_VOICE_ID=voice-id\nSPATIUS_AVATAR_BACKGROUND_URL=\n';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deploy-test-'));
  roots.push(root);
  await mkdir(join(root, 'agent/src'), { recursive: true });
  await mkdir(join(root, 'worker'));
  for (const [name, contents] of Object.entries({
    'package.json': JSON.stringify({
      name: 'my-app',
      packageManager: 'pnpm@11.1.2',
    }),
    'wrangler.jsonc':
      '{ // preserve this comment\n"name":"old", "vars":{"CUSTOM":"keep"},}',
    'worker/index.ts': '',
    'agent/src/agent.py': '@server.rtc_session(agent_name="spatius-agent")',
    'agent/Dockerfile': 'FROM python:3.13',
    'agent/.env.example': '',
    '.dev.vars.example': values,
    '.dev.vars': values,
    'agent/.env.local': values + 'SPATIUS_API_KEY=spatius-secret\n',
  }))
    await writeFile(join(root, name), contents);
  const messages: string[] = [];
  const events: string[] = [];
  const agents: AgentStatus[] = [];
  const secretPaths: string[] = [];
  const providers: DeploymentProviders = {
    probeWrangler: vi.fn(async () => true),
    probeLiveKit: vi.fn(async () => 'ready' as const),
    accounts: vi.fn(async () => [{ id: accountId, name: 'Account' }]),
    loginCloudflare: vi.fn(async () => {}),
    projects: vi.fn(async () => [{ name: 'Demo', subdomain: 'demo' }]),
    loginLiveKit: vi.fn(async () => {}),
    workerExists: vi.fn(async () => false),
    workerUrl: vi.fn(async () => 'https://my-app.example.workers.dev'),
    agents: vi.fn(async () => agents),
    build: vi.fn(async () => {
      events.push('build');
    }),
    deployAgent: vi.fn<DeploymentProviders['deployAgent']>(
      async (_state, secrets, create) => {
        events.push(create ? 'create' : 'update');
        secretPaths.push(secrets);
        expect(await readFile(secrets, 'utf8')).toContain(
          'SPATIUS_API_KEY="spatius-secret"',
        );
        expect(await readFile(secrets, 'utf8')).not.toContain('LIVEKIT');
        await writeFile(
          join(root, 'agent/livekit.toml'),
          '[project]\nsubdomain="demo"\n[agent]\nid="CA_test"\n',
        );
        agents.push({
          id: 'CA_test',
          region: 'us-east',
          name: 'spatius-agent',
          status: 'running',
          version: 'v1',
        });
      },
    ),
    waitForAgent: vi.fn(async () => {
      events.push('ready');
      return 'v1';
    }),
    deployWorker: vi.fn<DeploymentProviders['deployWorker']>(
      async (_state, secrets) => {
        events.push('worker');
        secretPaths.push(secrets);
        expect(JSON.parse(await readFile(secrets, 'utf8'))).toEqual({
          LIVEKIT_API_KEY: 'livekit-key',
          LIVEKIT_API_SECRET: 'livekit-secret',
        });
      },
    ),
    verify: vi.fn(async () => {
      events.push('verify');
    }),
  };
  const prompts = {
    choose: vi.fn(
      async (_message: string, _options: unknown, initial: string) => initial,
    ) as SetupPrompts['choose'],
    input: vi.fn<SetupPrompts['input']>(
      async (_message, options) => options?.initialValue ?? '',
    ),
    confirm: vi.fn(async () => true),
    password: vi.fn(async () => ''),
  };
  const run = vi.fn(async () => '');
  const options = {
    targetDirectory: root,
    prompts,
    onStatus: (message: string) => messages.push(message),
    dependencies: { providers, run },
  };
  return {
    root,
    options,
    providers,
    prompts,
    run,
    agents,
    messages,
    events,
    secretPaths,
  };
}
describe('guided deployment', () => {
  it('builds first, creates an agent, publishes secrets and verifies; later runs reuse identity', async () => {
    const f = await fixture();
    expect(await runDeployment(f.options)).toMatchObject({
      status: 'deployed',
      agentId: 'CA_test',
    });
    expect(f.events).toEqual(['build', 'create', 'ready', 'worker', 'verify']);
    const config = await readFile(join(f.root, 'wrangler.jsonc'), 'utf8');
    expect(config).toContain('preserve this comment');
    expect(config).toContain('"CUSTOM": "keep"');
    expect(config).toContain('voice-id');
    expect(config).not.toContain('livekit-secret');
    const state = await loadState(f.root);
    expect(state?.phase).toBe('complete');
    expect(JSON.stringify(state)).not.toContain('spatius-secret');
    expect(await readFile(join(f.root, '.gitignore'), 'utf8')).toContain(
      '/.spatius/',
    );
    await runDeployment(f.options);
    expect(f.providers.deployAgent).toHaveBeenCalledOnce();
    await writeFile(join(f.root, 'agent/src/extra.py'), 'changed');
    await runDeployment(f.options);
    expect(f.providers.deployAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: 'CA_test' }),
      expect.any(String),
      false,
    );
    for (const path of f.secretPaths)
      await expect(access(path)).rejects.toThrow();
    expect(f.messages.join('\n')).not.toContain('spatius-secret');
  });
  it('redeploys local code when the remote agent version has changed outside the guide', async () => {
    const f = await fixture();
    await runDeployment(f.options);
    f.agents[0]!.version = 'external-version';
    await runDeployment(f.options);
    expect(f.providers.deployAgent).toHaveBeenCalledTimes(2);
  });
  it.each(['npm', 'pnpm', 'bun'])(
    'retains the generated %s choice when no version or lockfile was recorded',
    async (manager) => {
      const f = await fixture();
      await writeFile(
        join(f.root, 'package.json'),
        JSON.stringify({
          name: 'app',
          scripts: { deploy: `${manager} run build && wrangler deploy` },
        }),
      );
      vi.mocked(f.providers.probeWrangler).mockResolvedValueOnce(false);
      await runDeployment(f.options);
      expect(f.run).toHaveBeenCalledWith(
        expect.objectContaining({ command: manager, args: ['install'] }),
      );
    },
  );
  it('declining final confirmation makes no build or remote mutations', async () => {
    const f = await fixture();
    vi.mocked(f.prompts.confirm).mockResolvedValue(false);
    expect(await runDeployment(f.options)).toEqual({ status: 'deferred' });
    expect(f.events).toEqual([]);
    expect(await loadState(f.root)).toBeUndefined();
  });
  it('resumes after a web failure without duplicating the ready agent', async () => {
    const f = await fixture();
    vi.mocked(f.providers.deployWorker).mockRejectedValueOnce(
      new Error('network failure'),
    );
    await expect(runDeployment(f.options)).rejects.toThrow('network failure');
    expect((await loadState(f.root))?.phase).toBe('deploying-web');
    await runDeployment(f.options);
    expect(f.providers.deployAgent).toHaveBeenCalledOnce();
  });
  it('stops after a failed build before creating cloud resources', async () => {
    const f = await fixture();
    vi.mocked(f.providers.build).mockRejectedValue(new Error('build failed'));
    await expect(runDeployment(f.options)).rejects.toThrow('build failed');
    expect(f.providers.deployAgent).not.toHaveBeenCalled();
  });
  it('retains agent identity on readiness failure and redacts diagnostics', async () => {
    const f = await fixture();
    vi.mocked(f.providers.waitForAgent).mockRejectedValue(
      new Error('spatius-secret failure'),
    );
    await expect(runDeployment(f.options)).rejects.toThrow(
      '[REDACTED] failure',
    );
    expect((await loadState(f.root))?.agentId).toBe('CA_test');
    expect(f.providers.deployWorker).not.toHaveBeenCalled();
    for (const path of f.secretPaths)
      await expect(access(path)).rejects.toThrow();
  });
  it('never recreates after ambiguous creation without a config or unique match', async () => {
    const f = await fixture();
    vi.mocked(f.providers.deployAgent).mockRejectedValue(new Error('timeout'));
    await expect(runDeployment(f.options)).rejects.toThrow('timeout');
    expect((await loadState(f.root))?.phase).toBe('creating');
    await expect(runDeployment(f.options)).rejects.toThrow('uncertain outcome');
    expect(f.providers.deployAgent).toHaveBeenCalledOnce();
  });
  it('reconciles an interrupted creation by unique dispatch name and region', async () => {
    const f = await fixture();
    vi.mocked(f.providers.deployAgent).mockRejectedValueOnce(
      new Error('timeout'),
    );
    await expect(runDeployment(f.options)).rejects.toThrow();
    f.agents.push({
      id: 'CA_test',
      region: 'us-east',
      name: 'spatius-agent',
      status: 'running',
      version: 'v1',
    });
    await runDeployment(f.options);
    expect(f.providers.deployAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: 'CA_test' }),
      expect.any(String),
      false,
    );
    expect(
      await readFile(join(f.root, 'agent/livekit.toml'), 'utf8'),
    ).toContain('CA_test');
  });
  it('rejects mismatched project, missing saved agent, and changed registration', async () => {
    const f = await fixture();
    await runDeployment(f.options);
    const saved = (await loadState(f.root))!;
    await saveState(f.root, { ...saved, subdomain: 'other' });
    await expect(runDeployment(f.options)).rejects.toThrow(
      'Setup LiveKit project differs',
    );
    await saveState(f.root, saved);
    f.agents.splice(0);
    await expect(runDeployment(f.options)).rejects.toThrow(
      'saved LiveKit agent',
    );
    await writeFile(join(f.root, 'agent/src/agent.py'), 'agent_name="other"');
    await expect(runDeployment(f.options)).rejects.toThrow('registration name');
  });
  it('blocks mismatched livekit.toml before provider calls', async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, 'agent/livekit.toml'),
      '[project]\nsubdomain="other"\n[agent]\nid="CA_other"',
    );
    await expect(runDeployment(f.options)).rejects.toThrow('differs');
    expect(f.providers.accounts).not.toHaveBeenCalled();
  });
  it('uses saved account despite multiple accounts and blocks inaccessible saved accounts', async () => {
    const f = await fixture();
    await runDeployment(f.options);
    vi.mocked(f.providers.accounts).mockResolvedValue([
      { id: 'b'.repeat(32), name: 'Other' },
      { id: accountId, name: 'Account' },
    ]);
    await runDeployment(f.options);
    expect(f.providers.deployWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId }),
      expect.any(String),
    );
    vi.mocked(f.providers.accounts).mockResolvedValue([
      { id: 'b'.repeat(32), name: 'Other' },
    ]);
    await expect(runDeployment(f.options)).rejects.toThrow('not accessible');
  });
  it('installs missing project dependencies and LiveKit, rechecks and continues', async () => {
    const f = await fixture();
    vi.mocked(f.providers.probeWrangler).mockResolvedValueOnce(false);
    vi.mocked(f.providers.probeLiveKit).mockResolvedValueOnce('missing');
    await runDeployment({
      ...f.options,
      dependencies: {
        ...f.options.dependencies,
        planInstall: async () => ({
          command: 'brew',
          args: ['install', 'livekit-cli'],
          displayCommand: 'brew install livekit-cli',
        }),
      },
    });
    expect(f.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm', args: ['install'] }),
    );
    expect(f.run).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'brew', interactive: true }),
    );
  });
  it('supports deferring missing tools and cancellation without deploying', async () => {
    const f = await fixture();
    vi.mocked(f.providers.probeWrangler).mockResolvedValue(false);
    f.prompts.choose = async () => 'later' as never;
    expect(await runDeployment(f.options)).toEqual({ status: 'deferred' });
    vi.mocked(f.providers.probeWrangler).mockRejectedValue(
      new PromptCancelledError(),
    );
    await expect(runDeployment(f.options)).rejects.toBeInstanceOf(
      PromptCancelledError,
    );
    expect(f.providers.deployAgent).not.toHaveBeenCalled();
  });
  it('reuses the credential wizard when setup is incomplete', async () => {
    const f = await fixture();
    await rm(join(f.root, '.dev.vars'));
    const setup = vi.fn(async () => {
      await writeFile(join(f.root, '.dev.vars'), values);
      return 'configured' as const;
    });
    await runDeployment({
      ...f.options,
      dependencies: { ...f.options.dependencies, setup },
    });
    expect(setup).toHaveBeenCalledOnce();
  });
  it('connects a missing LiveKit project and rejects a different login project', async () => {
    const f = await fixture();
    vi.mocked(f.providers.projects).mockResolvedValue([]);
    await expect(runDeployment(f.options)).rejects.toThrow(
      'must match LIVEKIT_URL',
    );
    expect(f.providers.loginLiveKit).toHaveBeenCalledOnce();
  });
  it('requires an explicit choice before overwriting an existing Worker', async () => {
    const f = await fixture();
    vi.mocked(f.providers.workerExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await runDeployment(f.options);
    expect(f.prompts.choose as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'This Worker already exists',
      expect.any(Array),
      'rename',
    );
    expect(f.providers.workerExists).toHaveBeenCalledTimes(2);
  });
  it('rejects concurrent runs and always releases the lock', async () => {
    const f = await fixture();
    await deploymentFiles.loadState(f.root);
    await writeFile(
      join(f.root, '.spatius/deploy.lock'),
      JSON.stringify({
        pid: process.pid,
        host: (await import('node:os')).hostname(),
      }),
    );
    await expect(runDeployment(f.options)).rejects.toThrow(
      'Another deployment',
    );
    await rm(join(f.root, '.spatius/deploy.lock'));
    await runDeployment(f.options);
    await expect(
      access(join(f.root, '.spatius/deploy.lock')),
    ).rejects.toThrow();
  });
});

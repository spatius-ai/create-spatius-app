import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { parse as parseJsonc } from 'jsonc-parser';
import { DeploymentCommandError, type DeploymentRunner } from './command.js';
import type { DeploymentState } from './state.js';
import { readRegular } from './state.js';
import type { SecretRedactor } from '../setup/redaction.js';
import { PromptCancelledError } from '../errors.js';

export class AuthenticationRequired extends Error {}

export interface Account {
  id: string;
  name: string;
}
export interface LiveKitProject {
  name: string;
  subdomain: string;
}
export interface AgentStatus {
  id: string;
  region: string;
  name: string;
  status: string;
  version: string;
  desiredVersion?: string;
}
export interface DeploymentProviders {
  probeWrangler(this: void): Promise<boolean>;
  probeLiveKit(this: void): Promise<'ready' | 'missing' | 'incompatible'>;
  accounts(this: void): Promise<Account[]>;
  loginCloudflare(this: void): Promise<void>;
  projects(this: void): Promise<LiveKitProject[]>;
  loginLiveKit(this: void): Promise<void>;
  workerExists(this: void, accountId: string, name: string): Promise<boolean>;
  workerUrl(this: void, accountId: string, name: string): Promise<string>;
  agents(this: void, project: string): Promise<AgentStatus[]>;
  build(this: void, state: DeploymentState): Promise<void>;
  deployAgent(
    this: void,
    state: DeploymentState,
    secretsFile: string,
    create: boolean,
  ): Promise<void>;
  waitForAgent(
    this: void,
    state: DeploymentState,
    dispatchName: string,
  ): Promise<string>;
  deployWorker(
    this: void,
    state: DeploymentState,
    secretsFile: string,
  ): Promise<void>;
  verify(this: void, url: string): Promise<void>;
}

/** Drop ambient target overrides; provider authentication itself remains usable. */
export function deploymentEnvironment(accountId?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('LIVEKIT_') ||
      key === 'CLOUDFLARE_ACCOUNT_ID' ||
      key === 'CF_ACCOUNT_ID' ||
      key === 'WRANGLER_SEND_METRICS'
    )
      delete env[key];
  }
  env.CLOUDFLARE_ENV = '';
  env.WRANGLER_SEND_METRICS = 'false';
  env.NO_COLOR = '1';
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  return env;
}
export function projectSubdomain(url: string): string {
  const parsed = new URL(url);
  const match = /^([a-z\d-]+)\.livekit\.cloud$/u.exec(parsed.hostname);
  if (
    !match ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !['wss:', 'https:'].includes(parsed.protocol)
  )
    throw new Error('Guided deployment requires a LiveKit Cloud project URL.');
  return match[1]!;
}
export function parseProjects(
  output: string,
  redactor: SecretRedactor,
): LiveKitProject[] {
  if (!output.trim()) return [];
  const projects = JSON.parse(output) as Array<{
    Name: string;
    URL: string;
    APIKey?: string;
    APISecret?: string;
  }>;
  if (!Array.isArray(projects))
    throw new Error(
      'Unexpected LiveKit project response. Update lk and retry.',
    );
  return projects.flatMap((project) => {
    redactor.add(project.APIKey, project.APISecret);
    try {
      return [{ name: project.Name, subdomain: projectSubdomain(project.URL) }];
    } catch {
      return [];
    }
  });
}
export function parseAgents(output: string): AgentStatus[] {
  const result = JSON.parse(output) as {
    agents?: Array<Record<string, unknown>>;
  };
  if (result && Object.keys(result).length === 0) return [];
  if (!Array.isArray(result.agents))
    throw new Error('Unexpected LiveKit agent response. Update lk and retry.');
  return result.agents.flatMap((agent) => {
    const id = agent.agent_id ?? agent.agentId;
    const deployments = agent.agent_deployments ?? agent.agentDeployments;
    if (typeof id !== 'string' || !Array.isArray(deployments))
      throw new Error('Incomplete LiveKit agent status.');
    const rows = deployments as Array<Record<string, unknown>>;
    const text = (value: unknown): string =>
      typeof value === 'string' ? value : '';
    return rows
      .filter((d) => !d.deployment || d.deployment === 'production')
      .map((d) => ({
        id,
        region: text(d.region),
        name: text(d.agent_name ?? d.agentName),
        status: text(d.status).toLowerCase(),
        version: text(d.version ?? agent.version),
        desiredVersion: text(agent.version),
      }));
  });
}

export function createProviders({
  root,
  manager,
  run,
  redactor,
  signal,
  request = fetch,
  sleep = (ms) => delay(ms, undefined, { signal }),
}: {
  root: string;
  manager: string;
  run: DeploymentRunner;
  redactor: SecretRedactor;
  signal: AbortSignal;
  request?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
}): DeploymentProviders {
  const wrangler = (args: string[], capture = true, accountId?: string) =>
    run({
      command: process.execPath,
      args: [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args],
      cwd: root,
      env: deploymentEnvironment(accountId),
      capture,
      timeoutMs: capture ? 60_000 : 30 * 60_000,
    });
  const lk = (args: string[], capture = true, project?: string) =>
    run({
      command: 'lk',
      args: [...(project ? ['--project', project] : []), '--yes', ...args],
      cwd: join(root, 'agent'),
      env: deploymentEnvironment(),
      capture,
      timeoutMs: capture ? 60_000 : 30 * 60_000,
    });
  const cloudflare = async (
    path: string,
  ): Promise<{
    response: Response;
    data: {
      success?: boolean;
      result?: unknown;
      errors?: Array<{ code: number }>;
    };
  }> => {
    const auth = JSON.parse(await wrangler(['auth', 'token', '--json'])) as {
      type: string;
      token?: string;
      key?: string;
      email?: string;
    };
    redactor.add(auth.token, auth.key);
    const headers: Record<string, string> = {};
    if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
    else if (auth.key && auth.email) {
      headers['X-Auth-Key'] = auth.key;
      headers['X-Auth-Email'] = auth.email;
    } else
      throw new Error(
        'Wrangler did not return usable Cloudflare authentication.',
      );
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${path}`,
      {
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        redirect: 'error',
      },
    );
    const data = (await response.json()) as {
      success?: boolean;
      result?: unknown;
      errors?: Array<{ code: number }>;
    };
    return { response, data };
  };
  const providers: DeploymentProviders = {
    async probeWrangler() {
      try {
        const help = await wrangler(['deploy', '--help']);
        const whoami = await wrangler(['whoami', '--help']);
        return help.includes('--secrets-file') && whoami.includes('--json');
      } catch (error) {
        if (signal.aborted) throw error;
        return false;
      }
    },
    async probeLiveKit() {
      try {
        await lk(['--version']);
      } catch (error) {
        if (signal.aborted) throw error;
        return 'missing';
      }
      try {
        for (const [args, flag] of [
          [['agent', 'create', '--help'], '--secrets-file'],
          [['agent', 'deploy', '--help'], '--secrets-file'],
          [['agent', 'list', '--help'], '--json'],
          [['project', 'list', '--help'], '--json'],
          [['--help'], '--yes'],
        ] as const)
          if (!(await lk([...args])).includes(flag)) return 'incompatible';
        return 'ready';
      } catch (error) {
        if (signal.aborted) throw error;
        return 'incompatible';
      }
    },
    async accounts() {
      let output: string;
      try {
        output = await wrangler(['whoami', '--json']);
      } catch (error) {
        if (error instanceof DeploymentCommandError) {
          let loggedOut = false;
          try {
            loggedOut =
              (JSON.parse(error.stdout) as { loggedIn?: boolean }).loggedIn ===
              false;
          } catch {
            /* not an auth response */
          }
          if (loggedOut)
            throw new AuthenticationRequired('Cloudflare login required.');
        }
        throw error;
      }
      const data = JSON.parse(output) as {
        loggedIn: boolean;
        accounts: Account[];
      };
      if (
        !data.loggedIn ||
        !Array.isArray(data.accounts) ||
        !data.accounts.length
      )
        throw new Error('No accessible Cloudflare accounts.');
      if (
        data.accounts.some(
          (a) => !/^[a-f\d]{32}$/u.test(a.id) || typeof a.name !== 'string',
        )
      )
        throw new Error('Invalid Cloudflare account response.');
      return data.accounts;
    },
    async loginCloudflare() {
      await run({
        command: process.execPath,
        args: [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'login'],
        cwd: root,
        env: deploymentEnvironment(),
        interactive: true,
      });
    },
    async projects() {
      return parseProjects(await lk(['project', 'list', '--json']), redactor);
    },
    async loginLiveKit() {
      await run({
        command: 'lk',
        args: ['cloud', 'auth'],
        cwd: tmpdir(),
        env: deploymentEnvironment(),
        interactive: true,
      });
    },
    async workerExists(accountId, name) {
      const { response, data } = await cloudflare(
        `${accountId}/workers/scripts/${encodeURIComponent(name)}/settings`,
      );
      if (response.status === 404 && data.errors?.some((e) => e.code === 10007))
        return false;
      if (!response.ok || !data.success)
        throw new Error(
          `Could not check Worker existence (Cloudflare HTTP ${response.status}). Check account access and retry.`,
        );
      return true;
    },
    async workerUrl(accountId, name) {
      const { response, data } = await cloudflare(
        `${accountId}/workers/subdomain`,
      );
      const result = data.result as { subdomain?: string } | undefined;
      if (
        !response.ok ||
        !data.success ||
        !result?.subdomain ||
        !/^[a-z\d-]+$/u.test(result.subdomain)
      )
        throw new Error(
          'Enable a workers.dev subdomain in the Cloudflare dashboard, then retry deployment.',
        );
      return `https://${name}.${result.subdomain}.workers.dev`;
    },
    async agents(project) {
      return parseAgents(await lk(['agent', 'list', '--json'], true, project));
    },
    async build(state) {
      await run({
        command: manager,
        args: ['run', 'build'],
        cwd: root,
        env: deploymentEnvironment(state.accountId),
      });
      // Verify Vite selected the intended config; never trust ambient .env overrides.
      const metadata = JSON.parse(
        (await readRegular(join(root, '.wrangler/deploy/config.json'))) ?? '{}',
      ) as { configPath?: string };
      if (!metadata.configPath)
        throw new Error(
          'Vite did not produce a Wrangler deployment configuration.',
        );
      const { resolve, dirname } = await import('node:path');
      const configPath = resolve(
        dirname(join(root, '.wrangler/deploy/config.json')),
        metadata.configPath,
      );
      const built = parseJsonc((await readRegular(configPath)) ?? '{}') as {
        name?: string;
        account_id?: string;
      };
      if (
        built.name !== state.workerName ||
        built.account_id !== state.accountId
      )
        throw new Error(
          'The built Worker target differs from the reviewed deployment. Check Vite and environment configuration.',
        );
    },
    async deployAgent(state, secretsFile, create) {
      await lk(
        [
          'agent',
          create ? 'create' : 'deploy',
          '--secrets-file',
          secretsFile,
          ...(create ? ['--region', state.region] : []),
          '.',
        ],
        false,
        state.projectName,
      );
    },
    async waitForAgent(state, dispatchName) {
      for (let attempt = 0; attempt < 60; attempt++) {
        signal.throwIfAborted();
        const agent = (await providers.agents(state.projectName)).find(
          (a) => a.id === state.agentId && a.region === state.region,
        );
        if (
          agent &&
          ['failed', 'error', 'crashed', 'build_failed'].includes(agent.status)
        )
          throw new Error(
            'LiveKit agent failed. Inspect lk agent logs from agent/ before retrying.',
          );
        if (
          agent?.status === 'running' &&
          agent.name === dispatchName &&
          (!agent.desiredVersion || agent.version === agent.desiredVersion)
        )
          return agent.version;
        await sleep(10_000);
      }
      throw new Error(
        'LiveKit agent readiness timed out. Inspect lk agent status and lk agent logs from agent/, then retry.',
      );
    },
    async deployWorker(state, secretsFile) {
      await wrangler(
        ['deploy', '--secrets-file', secretsFile],
        false,
        state.accountId,
      );
    },
    async verify(url) {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          for (const path of ['/', '/api/health']) {
            const response = await request(new URL(path, url), {
              signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              redirect: 'error',
            });
            if (!response.ok) throw new Error('HTTP check failed.');
            if (
              path === '/api/health' &&
              ((await response.json()) as { ok?: boolean }).ok !== true
            )
              throw new Error('Health check failed.');
            if (path === '/') await response.body?.cancel();
          }
          return;
        } catch {
          if (signal.aborted)
            throw new PromptCancelledError(
              'Deployment verification cancelled.',
            );
          if (attempt === 5)
            throw new Error(
              `Deployment published at ${url}, but HTTP verification failed. Check the app and retry.`,
            );
          await sleep(5000);
        }
      }
    },
  };
  return providers;
}

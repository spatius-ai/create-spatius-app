import { mkdtemp, chmod, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { PromptCancelledError } from '../errors.js';
import type { SetupPrompts } from '../prompts.js';
import {
  parseDotenv,
  readCredentialFileState,
  validateCredentialBundle,
} from '../setup/environment.js';
import { assertSpatiusProject } from '../setup/project.js';
import { runCredentialSetup } from '../setup/wizard.js';
import { SecretRedactor } from '../setup/redaction.js';
import {
  planLiveKitInstall,
  LIVEKIT_INSTALL_GUIDE,
} from '../setup/livekit-install.js';
import { createDeploymentRunner, type DeploymentRunner } from './command.js';
import {
  createProviders,
  AuthenticationRequired,
  projectSubdomain,
  type DeploymentProviders,
} from './providers.js';
import {
  deploymentFiles,
  workerConfiguration,
  type DeploymentFiles,
  type DeploymentState,
} from './state.js';

export interface DeploymentOptions {
  targetDirectory: string;
  prompts: SetupPrompts;
  onStatus?: (message: string) => void;
  onWarning?: (message: string) => void;
  onOutput?: (message: string) => void;
  dependencies?: {
    run?: DeploymentRunner;
    providers?: DeploymentProviders;
    files?: DeploymentFiles;
    setup?: typeof runCredentialSetup;
    planInstall?: typeof planLiveKitInstall;
  };
}
export interface DeploymentResult {
  status: 'deployed' | 'deferred';
  url?: string;
  agentId?: string;
}

export async function runDeployment({
  targetDirectory: root,
  prompts,
  onStatus = () => undefined,
  onWarning = onStatus,
  onOutput = onStatus,
  dependencies = {},
}: DeploymentOptions): Promise<DeploymentResult> {
  await assertSpatiusProject(root);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const redactor = new SecretRedactor();
  const status = (message: string) => onStatus(redactor.redact(message));
  const warning = (message: string) => onWarning(redactor.redact(message));
  const run =
    dependencies.run ??
    createDeploymentRunner(redactor, onOutput, controller.signal);
  const files = dependencies.files ?? deploymentFiles;
  const checkCancelled = () => {
    if (controller.signal.aborted)
      throw new PromptCancelledError(
        'Deployment cancelled. Remote work already accepted may continue.',
      );
  };
  let temp: string | undefined;
  let releaseLock: (() => Promise<void>) | undefined;
  let state: DeploymentState | undefined;
  try {
    state = await files.loadState(root);
    const lockPath = join(root, '.spatius/deploy.lock');
    const existingLock = await files.readRegular(lockPath);
    if (existingLock) {
      const lock = JSON.parse(existingLock) as { pid: number; host: string };
      if (
        lock.host !== hostname() ||
        !Number.isInteger(lock.pid) ||
        lock.pid <= 0
      )
        throw new Error(
          'A deployment lock exists. Verify no deployment is running before removing .spatius/deploy.lock.',
        );
      let active = true;
      try {
        process.kill(lock.pid, 0);
      } catch (error) {
        active = (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
      if (active)
        throw new Error('Another deployment is running for this project.');
      await rm(lockPath);
    }
    const lock = await open(lockPath, 'wx', 0o600);
    releaseLock = async () => {
      await lock.close();
      await rm(lockPath, { force: true });
    };
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, host: hostname() }),
    );
    state = await files.loadState(root);
    let credentials = await readCredentialFileState(root);
    if (credentials.status !== 'complete') {
      if (
        !(await prompts.confirm(
          'Configure credentials before deployment?',
          true,
        ))
      )
        return { status: 'deferred' };
      await (dependencies.setup ?? runCredentialSetup)({
        targetDirectory: root,
        prompts,
        onStatus: status,
        onWarning: warning,
      });
      credentials = await readCredentialFileState(root);
      if (credentials.status !== 'complete')
        throw new Error(
          'Complete credential setup before deployment: npx create-spatius-app setup . --interactive',
        );
    }
    const worker = parseDotenv(credentials.worker!);
    const agent = parseDotenv(credentials.agent!);
    const bundle = validateCredentialBundle({
      liveKit: {
        url: worker.get('LIVEKIT_URL')!,
        apiKey: worker.get('LIVEKIT_API_KEY')!,
        apiSecret: worker.get('LIVEKIT_API_SECRET')!,
      },
      spatius: {
        apiKey: agent.get('SPATIUS_API_KEY')!,
        appId: worker.get('SPATIUS_APP_ID')!,
        avatarId: worker.get('SPATIUS_AVATAR_ID')!,
      },
      ...(worker.has('CARTESIA_VOICE_ID')
        ? { voiceId: worker.get('CARTESIA_VOICE_ID')! }
        : {}),
    });
    redactor.add(
      bundle.liveKit.apiKey,
      bundle.liveKit.apiSecret,
      bundle.spatius.apiKey,
    );
    const subdomain = projectSubdomain(bundle.liveKit.url);
    const dispatchName = worker.get('LIVEKIT_AGENT_NAME')!;
    const source = await files.readRegular(join(root, 'agent/src/agent.py'));
    if (
      ![...(source ?? '').matchAll(/agent_name\s*=\s*(['"])(.*?)\1/gu)].some(
        (match) => match[2] === dispatchName,
      )
    )
      throw new Error(
        'The agent registration name differs from LIVEKIT_AGENT_NAME. Reconcile agent/src/agent.py and .dev.vars before deploying.',
      );
    if (state && state.subdomain !== subdomain)
      throw new Error(
        'Setup LiveKit project differs from the saved deployment. Restore matching setup credentials before retrying.',
      );
    const config = await files.readAgentConfig(root);
    if (
      config &&
      (config.subdomain !== subdomain ||
        (state?.agentId && config.id !== state.agentId))
    )
      throw new Error(
        'agent/livekit.toml differs from the saved project or agent. Reconcile the deployment files before retrying.',
      );
    const metadata = JSON.parse(
      (await files.readRegular(join(root, 'package.json'))) ?? '{}',
    ) as {
      name: string;
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const manager =
      metadata.packageManager?.split('@')[0] ??
      metadata.scripts?.deploy?.match(/^(npm|pnpm|bun) run build\b/u)?.[1] ??
      ((await files.readRegular(join(root, 'pnpm-lock.yaml')))
        ? 'pnpm'
        : (await files.readRegular(join(root, 'bun.lock')))
          ? 'bun'
          : 'npm');
    if (!['npm', 'pnpm', 'bun'].includes(manager))
      throw new Error('Deployment supports npm, pnpm, and bun projects.');
    const providers =
      dependencies.providers ??
      createProviders({
        root,
        manager,
        run,
        redactor,
        signal: controller.signal,
      });
    status('Checking deployment tools…');
    while (!(await providers.probeWrangler())) {
      checkCancelled();
      const command = `${manager} install`;
      status(`Install the project dependencies: ${command}`);
      const action = await prompts.choose(
        'Prepare Wrangler',
        [
          { label: 'Install project dependencies', value: 'install' },
          { label: "I've installed them — check again", value: 'retry' },
          { label: 'Deploy later', value: 'later' },
        ],
        'install',
      );
      if (action === 'later') return { status: 'deferred' };
      if (action === 'install') {
        try {
          await run({ command: manager, args: ['install'], cwd: root });
        } catch (error) {
          if (error instanceof PromptCancelledError) throw error;
          warning('Dependency installation failed. Retry or finish later.');
        }
      }
      warning(
        'Wrangler must support deploy --secrets-file and whoami --json. If already installed, update the project dependency before checking again.',
      );
    }
    let probe = await providers.probeLiveKit();
    while (probe !== 'ready') {
      checkCancelled();
      const plan = await (dependencies.planInstall ?? planLiveKitInstall)(
        probe === 'incompatible',
      );
      status(
        plan
          ? `LiveKit CLI command: ${plan.displayCommand}`
          : `Install LiveKit CLI: ${LIVEKIT_INSTALL_GUIDE}`,
      );
      const action = await prompts.choose(
        'Prepare LiveKit CLI',
        [
          ...(plan
            ? [{ label: 'Install or update LiveKit CLI', value: 'install' }]
            : []),
          { label: "I've installed it — check again", value: 'retry' },
          { label: 'Deploy later', value: 'later' },
        ],
        plan ? 'install' : 'retry',
      );
      if (action === 'later') return { status: 'deferred' };
      if (action === 'install' && plan) {
        try {
          await run({
            command: plan.command,
            args: plan.args,
            cwd: tmpdir(),
            interactive: true,
          });
        } catch (error) {
          if (error instanceof PromptCancelledError) throw error;
          warning('LiveKit installation failed. Retry or deploy later.');
        }
      }
      probe = await providers.probeLiveKit();
      if (probe !== 'ready')
        warning(
          'A compatible lk is still unavailable. If PATH changed, open a new terminal and run npx create-spatius-app deploy.',
        );
    }
    let accounts;
    try {
      accounts = await providers.accounts();
    } catch (error) {
      if (error instanceof PromptCancelledError) throw error;
      checkCancelled();
      if (!(error instanceof AuthenticationRequired)) throw error;
      status('Connect Cloudflare in your browser…');
      await providers.loginCloudflare();
      accounts = await providers.accounts();
    }
    const accountId =
      state?.accountId ??
      (accounts.length === 1
        ? accounts[0]!.id
        : await prompts.choose(
            'Cloudflare account',
            accounts.map((a) => ({
              label: `${a.name} (${a.id})`,
              value: a.id,
            })),
            accounts[0]!.id,
          ));
    if (!accounts.some((a) => a.id === accountId))
      throw new Error(
        'The saved Cloudflare account is not accessible. Sign in to that account and retry.',
      );
    let projects = await providers.projects();
    if (!projects.some((p) => p.subdomain === subdomain)) {
      status(`Connect the LiveKit project ${subdomain} in your browser…`);
      await providers.loginLiveKit();
      projects = await providers.projects();
    }
    const project = projects.find((p) => p.subdomain === subdomain);
    if (!project)
      throw new Error(
        'The linked LiveKit project must match LIVEKIT_URL from setup.',
      );
    // Re-resolve the local CLI alias by URL; never fall back to its default project.
    if (state) state.projectName = project.name;
    const agents = await providers.agents(project.name);
    if (!state) {
      let workerName =
        (metadata.name ?? 'spatius-app')
          .toLowerCase()
          .replace(/[^a-z\d-]/gu, '-')
          .replace(/^-+|-+$/gu, '')
          .slice(0, 63) || 'spatius-app';
      while (true) {
        workerName = await prompts.input('Cloudflare Worker name', {
          initialValue: workerName,
        });
        if (!/^[a-z\d][a-z\d-]{0,62}$/u.test(workerName)) {
          warning(
            'Use 1–63 lowercase letters, digits, or hyphens, starting with a letter or digit.',
          );
          continue;
        }
        if (!(await providers.workerExists(accountId, workerName))) break;
        const action = await prompts.choose(
          'This Worker already exists',
          [
            { label: 'Choose another name', value: 'rename' },
            { label: 'Update this Worker', value: 'update' },
          ],
          'rename',
        );
        if (action === 'update') break;
      }
      const existing = config
        ? agents.find((a) => a.id === config.id)
        : undefined;
      if (config && !existing)
        throw new Error(
          'The configured LiveKit agent was not found in this project. Restore its configuration before retrying.',
        );
      const region =
        existing?.region ??
        (await prompts.choose(
          'LiveKit agent region',
          [
            { label: 'US East — Virginia', value: 'us-east' },
            { label: 'Europe — Frankfurt', value: 'eu-central' },
            { label: 'Asia — Mumbai', value: 'ap-south' },
          ],
          'us-east',
        ));
      state = {
        version: 1,
        accountId,
        workerName,
        projectName: project.name,
        subdomain,
        region,
        phase: 'prepared',
        ...(config ? { agentId: config.id } : {}),
      };
    }
    if (config && !state.agentId) state.agentId = config.id;
    if (!state.agentId && state.phase === 'creating') {
      const matches = [
        ...new Set(
          agents
            .filter(
              (a) => a.name === dispatchName && a.region === state!.region,
            )
            .map((a) => a.id),
        ),
      ];
      if (matches.length !== 1)
        throw new Error(
          `An earlier agent creation has an uncertain outcome. In agent/, run lk --project ${project.name} agent list and restore livekit.toml for the intended agent. No new agent was created.`,
        );
      state.agentId = matches[0]!;
    }
    if (state.agentId) {
      const remote = agents.find(
        (a) => a.id === state!.agentId && a.region === state!.region,
      );
      if (!remote)
        throw new Error(
          'The saved LiveKit agent or region was not found. Check agent/livekit.toml and provider state; no replacement will be created automatically.',
        );
    }
    state.url = await providers.workerUrl(accountId, state.workerName);
    status(
      `Cloudflare: ${accounts.find((a) => a.id === accountId)!.name} / ${state.workerName}\nLiveKit: ${project.name} (${subdomain}) / ${state.region}\nSpatius avatar: ${bundle.spatius.avatarId}\nApplication: ${state.url}\nDeployment publishes an accessible app and uses Cloudflare, LiveKit, and Spatius resources.`,
    );
    if (!(await prompts.confirm('Deploy this app?', false)))
      return { status: 'deferred' };
    checkCancelled();
    await files.saveState(root, state);
    if (state.agentId && !config) {
      await files.atomicWrite(
        join(root, 'agent/livekit.toml'),
        `[project]\nsubdomain = ${JSON.stringify(subdomain)}\n\n[agent]\nid = ${JSON.stringify(state.agentId)}\n`,
      );
    }
    const wranglerPath = join(root, 'wrangler.jsonc');
    const configuration = await files.readRegular(wranglerPath);
    await files.atomicWrite(
      wranglerPath,
      workerConfiguration(configuration!, state, worker),
    );
    status('Building the frontend and Worker…');
    await providers.build(state);
    checkCancelled();
    const secrets = {
      SPATIUS_API_KEY: bundle.spatius.apiKey,
      SPATIUS_APP_ID: bundle.spatius.appId,
    };
    const fingerprint = await files.agentFingerprint(root, secrets);
    temp = await mkdtemp(join(tmpdir(), 'spatius-deploy-'));
    await chmod(temp, 0o700);
    const agentSecrets = join(temp, 'agent.env');
    const workerSecrets = join(temp, 'worker.json');
    // dotenv-safe quoted values; never pass secret values through command arguments.
    await writeFile(
      agentSecrets,
      Object.entries(secrets)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    await writeFile(
      workerSecrets,
      JSON.stringify({
        LIVEKIT_API_KEY: bundle.liveKit.apiKey,
        LIVEKIT_API_SECRET: bundle.liveKit.apiSecret,
      }),
      { mode: 0o600 },
    );
    const canReuse =
      state.agentId &&
      state.agentVersion &&
      agents.some(
        (a) =>
          a.id === state!.agentId &&
          a.region === state!.region &&
          a.version === state!.agentVersion,
      ) &&
      state.agentFingerprint === fingerprint &&
      ['agent-ready', 'deploying-web', 'complete'].includes(state.phase);
    if (!canReuse) {
      const create = !state.agentId;
      state.phase = create ? 'creating' : 'deploying-agent';
      await files.saveState(root, state);
      status(
        create
          ? 'Creating and building the LiveKit agent…'
          : 'Deploying an updated LiveKit agent…',
      );
      let deploymentError: Error | undefined;
      try {
        await providers.deployAgent(state, agentSecrets, create);
      } catch (error) {
        deploymentError =
          error instanceof Error
            ? error
            : new Error('LiveKit deployment failed.');
      }
      {
        const created = await files.readAgentConfig(root);
        if (created) {
          if (
            created.subdomain !== subdomain ||
            (state.agentId && state.agentId !== created.id)
          )
            throw new Error(
              'LiveKit returned a different deployment target. Reconcile agent/livekit.toml before continuing.',
            );
          state.agentId = created.id;
          await files.saveState(root, state);
        }
      }
      if (deploymentError) throw deploymentError;
      if (!state.agentId)
        throw new Error(
          'LiveKit creation did not save an agent ID. The remote build may still be running; retry to reconcile it.',
        );
    } else status('Reusing the unchanged LiveKit agent deployment…');
    status('Waiting for the LiveKit agent to be ready…');
    state.agentVersion = await providers.waitForAgent(state, dispatchName);
    state.agentFingerprint = fingerprint;
    state.phase = 'agent-ready';
    await files.saveState(root, state);
    checkCancelled();
    status('Publishing the frontend and Worker to Cloudflare…');
    state.phase = 'deploying-web';
    await files.saveState(root, state);
    await providers.deployWorker(state, workerSecrets);
    status('Checking the application URL and API health…');
    await providers.verify(state.url);
    state.phase = 'complete';
    await files.saveState(root, state);
    status(
      `App deployed: ${state.url}\nLiveKit agent: ${state.agentId}\nHTTP checks passed. Open the app and start a voice session to check audio and avatar playback.\nDeploy updates: npx create-spatius-app deploy`,
    );
    return { status: 'deployed', url: state.url, agentId: state.agentId };
  } catch (error) {
    if (state?.agentId)
      warning(
        `LiveKit agent ${state.agentId} is retained. Cloudflare ${state.workerName} may have an earlier or partially completed deployment${state.url ? ` at ${state.url}` : ''}. Retry with npx create-spatius-app deploy; saved targets will be reused.`,
      );
    if (error instanceof PromptCancelledError || controller.signal.aborted)
      throw new PromptCancelledError(
        'Deployment cancelled. Saved resources are retained; remote work may continue.',
      );
    throw redactor.error(error, 'Deployment failed.');
  } finally {
    try {
      if (temp) await rm(temp, { recursive: true, force: true });
    } finally {
      try {
        await releaseLock?.();
      } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
    }
  }
}

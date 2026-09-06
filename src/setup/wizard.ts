import { basename } from 'node:path';

import { PromptCancelledError } from '../errors.js';
import type { SetupPrompts } from '../prompts.js';
import { CHARACTER_VOICES } from '../templates/cloudflare-livekit/voices.js';
import {
  buildCredentialFileContents,
  type CredentialBundle,
  type CredentialFileState,
  type LiveKitCredentials,
  readCredentialExamples,
  readCredentialFileState,
  parseDotenv,
  type SpatiusCredentials,
  validateCredentialBundle,
  validateLiveKitUrl,
  writeCredentialFilesAtomically,
} from './environment.js';
import {
  loadLiveKitCredentialsWithCli,
  probeLiveKitCli,
  type LiveKitCliProbe,
} from './livekit.js';
import {
  authenticateLiveKitCli,
  installLiveKitCli,
  LIVEKIT_INSTALL_GUIDE,
  planLiveKitInstall,
} from './livekit-install.js';
import { assertSpatiusProject } from './project.js';
import { SecretRedactor } from './redaction.js';
import { loginToSpatius, type SpatiusCallbackServer } from './spatius-auth.js';
import {
  SPATIUS_CONSOLE_BASE_URL,
  SpatiusApiClient,
  SpatiusAuthenticatedSession,
  type SpatiusRequestDiagnostic,
} from './spatius-api.js';
import { selectSpatiusResources } from './spatius-resources.js';

export type CredentialSetupResult = 'configured' | 'unchanged';

export interface CredentialSetupDependencies {
  authenticateLiveKit?: () => Promise<void>;
  installLiveKit?: typeof installLiveKitCli;
  planLiveKitInstall?: typeof planLiveKitInstall;
  createSpatiusClient?: () => SpatiusApiClient;
  loadLiveKitCredentials?: () => Promise<LiveKitCredentials>;
  loginToSpatius?: (options: {
    client: SpatiusApiClient;
    onAuthorizationUrl: (url: string) => void;
    onBrowserOpenFailure: (error: Error) => void;
    redactor: SecretRedactor;
  }) => Promise<SpatiusAuthenticatedSession>;
  probeLiveKit?: () => Promise<LiveKitCliProbe>;
  readExamples?: typeof readCredentialExamples;
  readState?: typeof readCredentialFileState;
  selectSpatiusResources?: typeof selectSpatiusResources;
  validateProject?: typeof assertSpatiusProject;
  writeFiles?: typeof writeCredentialFilesAtomically;
}

interface CredentialSetupOptions {
  dependencies?: CredentialSetupDependencies;
  onDiagnostic?: (event: SpatiusRequestDiagnostic) => void;
  onStatus?: (message: string) => void;
  onWarning?: (message: string) => void;
  projectName?: string;
  prompts: SetupPrompts;
  targetDirectory: string;
}

async function collectManualLiveKitCredentials(
  prompts: SetupPrompts,
): Promise<LiveKitCredentials> {
  const url = validateLiveKitUrl(
    await prompts.input('LiveKit URL', {
      placeholder: 'wss://your-project.livekit.cloud',
    }),
  );
  const apiKey = await prompts.password('LiveKit API key');
  const apiSecret = await prompts.password('LiveKit API secret');
  return validateCredentialBundle({
    liveKit: { apiKey, apiSecret, url },
    spatius: {
      apiKey: 'validation-only',
      appId: 'validation-only',
      avatarId: 'validation-only',
    },
  }).liveKit;
}

async function collectLiveKitCredentials(
  prompts: SetupPrompts,
  dependencies: Required<
    Pick<
      CredentialSetupDependencies,
      | 'loadLiveKitCredentials'
      | 'probeLiveKit'
      | 'planLiveKitInstall'
      | 'installLiveKit'
      | 'authenticateLiveKit'
    >
  >,
  onStatus: (message: string) => void,
  onWarning: (message: string) => void,
): Promise<LiveKitCredentials | undefined> {
  let probe = await dependencies.probeLiveKit();
  let useCli = false;
  while (true) {
    if (!probe.available) {
      const update = probe.reason === 'incompatible';
      onWarning(
        update
          ? 'The installed LiveKit CLI needs an update to support `lk app env`.'
          : 'LiveKit CLI was not found on PATH. It is needed for browser-based setup.',
      );
      const plan = await dependencies.planLiveKitInstall(update);
      onStatus(
        plan === undefined
          ? `Install or update LiveKit CLI, then check again: ${LIVEKIT_INSTALL_GUIDE}`
          : `${update ? 'Update' : 'Install'} command: ${plan.displayCommand}`,
      );
      const action = await prompts.choose(
        'Connect your LiveKit project',
        [
          ...(plan === undefined
            ? []
            : [
                {
                  label: `${update ? 'Update' : 'Install'} LiveKit CLI and connect`,
                  value: 'install',
                  hint: 'Recommended; runs the command shown above',
                },
              ]),
          { label: "I've installed it — check again", value: 'retry' },
          { label: 'Enter credentials manually', value: 'manual' },
          { label: 'Set up later', value: 'skip' },
        ],
        plan === undefined ? 'manual' : 'install',
      );
      if (action === 'skip') return undefined;
      if (action === 'manual') return collectManualLiveKitCredentials(prompts);
      if (action === 'install' && plan !== undefined) {
        try {
          onStatus(`${update ? 'Updating' : 'Installing'} LiveKit CLI…`);
          await dependencies.installLiveKit(plan);
        } catch (error) {
          if (error instanceof PromptCancelledError) throw error;
          onWarning(
            'LiveKit CLI installation did not complete. Retry, enter credentials manually, or set up later.',
          );
          continue;
        }
      }
      probe = await dependencies.probeLiveKit();
      if (!probe.available) {
        onWarning(
          'A compatible lk is still unavailable in this terminal. If installation changed PATH, open a new terminal and run create-spatius-app setup . --interactive from your project.',
        );
        continue;
      }
      onStatus('LiveKit CLI is ready.');
      useCli = true;
    }

    const source = useCli
      ? 'cli'
      : await prompts.choose(
          'How should LiveKit credentials be configured?',
          [
            {
              hint:
                probe.version === undefined
                  ? 'Recommended; uses `lk app env`'
                  : `Recommended; lk ${probe.version}`,
              label: 'Use the LiveKit CLI',
              value: 'cli',
            },
            {
              hint: 'Opens LiveKit in your browser using `lk cloud auth`',
              label: 'Connect another LiveKit project',
              value: 'connect',
            },
            {
              hint: 'Values are entered with secret masking',
              label: 'Enter credentials manually',
              value: 'manual',
            },
            { label: 'Set up later', value: 'skip' },
          ],
          'cli',
        );
    if (source === 'skip') return undefined;
    if (source === 'manual') return collectManualLiveKitCredentials(prompts);
    try {
      if (source === 'connect') {
        onStatus(
          'Opening LiveKit in your browser. Sign in and select a project.',
        );
        await dependencies.authenticateLiveKit();
      }
      onStatus(
        'Starting the LiveKit project credential flow… Follow the LiveKit prompts to select a linked project or sign in through your browser.',
      );
      return await dependencies.loadLiveKitCredentials();
    } catch (error) {
      if (error instanceof PromptCancelledError) throw error;
      onWarning(
        'The LiveKit CLI flow did not complete or returned invalid credentials.',
      );
      const action = await prompts.choose(
        'How should LiveKit setup continue?',
        [
          { label: 'Retry LiveKit connection', value: 'retry' },
          { label: 'Enter credentials manually', value: 'manual' },
          { label: 'Set up later', value: 'skip' },
        ],
        'manual',
      );
      if (action === 'skip') return undefined;
      if (action === 'manual') return collectManualLiveKitCredentials(prompts);
      useCli = false;
    }
  }
}

async function collectManualSpatiusCredentials(
  prompts: SetupPrompts,
): Promise<SpatiusCredentials> {
  return {
    apiKey: await prompts.password('Spatius API key'),
    appId: await prompts.password('Spatius app ID'),
    avatarId: await prompts.password('Spatius avatar ID'),
  };
}

async function collectBrowserSpatiusCredentials(
  prompts: SetupPrompts,
  projectName: string,
  client: SpatiusApiClient,
  dependencies: Required<
    Pick<
      CredentialSetupDependencies,
      'loginToSpatius' | 'selectSpatiusResources'
    >
  >,
  redactor: SecretRedactor,
  onStatus: (message: string) => void,
  onWarning: (message: string) => void,
): Promise<SpatiusCredentials> {
  let session: SpatiusAuthenticatedSession | undefined;
  try {
    session = await dependencies.loginToSpatius({
      client,
      onAuthorizationUrl: (url) => {
        onStatus(`Approve Spatius access in your browser:\n${url}`);
      },
      onBrowserOpenFailure: () => {
        onWarning(
          'The browser could not be opened automatically. Use the printed authorization URL.',
        );
      },
      redactor,
    });
    return await dependencies.selectSpatiusResources({
      client,
      onWarning,
      projectName,
      prompts,
      redactor,
      session,
    });
  } finally {
    if (session !== undefined) {
      await session.revoke().catch(() => {
        onWarning(
          'The temporary Spatius CLI session could not be revoked automatically. No session token was stored locally.',
        );
      });
    }
  }
}

async function collectSpatiusCredentials(
  prompts: SetupPrompts,
  projectName: string,
  client: SpatiusApiClient,
  dependencies: Required<
    Pick<
      CredentialSetupDependencies,
      'loginToSpatius' | 'selectSpatiusResources'
    >
  >,
  redactor: SecretRedactor,
  onStatus: (message: string) => void,
  onWarning: (message: string) => void,
): Promise<SpatiusCredentials> {
  const source = await prompts.choose(
    'How should Spatius credentials be configured?',
    [
      {
        hint: 'Recommended; login is temporary and browser-approved',
        label: 'Sign in with Spatius Studio',
        value: 'browser',
      },
      {
        hint: 'Values are entered with secret masking',
        label: 'Enter credentials manually',
        value: 'manual',
      },
    ],
    'browser',
  );
  if (source === 'manual') {
    return collectManualSpatiusCredentials(prompts);
  }

  try {
    return await collectBrowserSpatiusCredentials(
      prompts,
      projectName,
      client,
      dependencies,
      redactor,
      onStatus,
      onWarning,
    );
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      throw error;
    }
    const detail = redactor.redact(
      error instanceof Error ? error.message : 'Unknown provider error.',
    );
    onWarning(`Spatius browser setup did not complete: ${detail}`);
    const useManual = await prompts.confirm(
      'Enter Spatius credentials manually instead?',
      true,
    );
    if (!useManual) {
      throw new PromptCancelledError('Credential setup was cancelled.');
    }
    return collectManualSpatiusCredentials(prompts);
  }
}

async function confirmReplacement(
  state: CredentialFileState,
  prompts: SetupPrompts,
  onWarning: (message: string) => void,
): Promise<boolean> {
  if (state.status === 'complete') {
    const keep = await prompts.confirm(
      'A complete, consistent local credential configuration already exists. Keep it?',
      true,
    );
    if (keep) return false;
  } else if (state.hasManagedValues) {
    onWarning(
      state.status === 'inconsistent'
        ? 'The Worker and agent credential files contain inconsistent managed values.'
        : 'The local credential files contain only part of the required configuration.',
    );
  } else {
    return true;
  }

  return prompts.confirm(
    'Replace the existing managed credential values? Unrelated variables and comments will be preserved.',
    false,
  );
}

function defaultClient(
  onDiagnostic?: (event: SpatiusRequestDiagnostic) => void,
): SpatiusApiClient {
  const testBaseUrl =
    process.env.NODE_ENV === 'test'
      ? process.env.CREATE_SPATIUS_APP_TEST_SPATIUS_BASE_URL
      : undefined;
  return new SpatiusApiClient(
    testBaseUrl ?? SPATIUS_CONSOLE_BASE_URL,
    fetch,
    onDiagnostic,
  );
}

export async function runCredentialSetup({
  dependencies = {},
  onDiagnostic,
  onStatus = () => undefined,
  onWarning = () => undefined,
  projectName,
  prompts,
  targetDirectory,
}: CredentialSetupOptions): Promise<CredentialSetupResult> {
  const validateProject = dependencies.validateProject ?? assertSpatiusProject;
  const readState = dependencies.readState ?? readCredentialFileState;
  const readExamples = dependencies.readExamples ?? readCredentialExamples;
  const writeFiles = dependencies.writeFiles ?? writeCredentialFilesAtomically;
  const setupDependencies = {
    authenticateLiveKit:
      dependencies.authenticateLiveKit ?? authenticateLiveKitCli,
    installLiveKit: dependencies.installLiveKit ?? installLiveKitCli,
    planLiveKitInstall: dependencies.planLiveKitInstall ?? planLiveKitInstall,
    createSpatiusClient:
      dependencies.createSpatiusClient ?? (() => defaultClient(onDiagnostic)),
    loadLiveKitCredentials:
      dependencies.loadLiveKitCredentials ??
      (() => loadLiveKitCredentialsWithCli()),
    loginToSpatius:
      dependencies.loginToSpatius ??
      ((options) =>
        loginToSpatius({
          ...options,
          ...(process.env.NODE_ENV === 'test' &&
          process.env.CREATE_SPATIUS_APP_TEST_NO_BROWSER === '1'
            ? { openBrowser: () => Promise.resolve() }
            : {}),
        })),
    probeLiveKit: dependencies.probeLiveKit ?? (() => probeLiveKitCli()),
    selectSpatiusResources:
      dependencies.selectSpatiusResources ?? selectSpatiusResources,
  };

  // Validate the project boundary before inspecting any credential file.
  await validateProject(targetDirectory);
  const state = await readState(targetDirectory);
  const shouldReplace = await confirmReplacement(state, prompts, onWarning);
  if (!shouldReplace) {
    onStatus('Existing local credentials were left unchanged.');
    return 'unchanged';
  }

  const redactor = new SecretRedactor();
  const liveKit = await collectLiveKitCredentials(
    prompts,
    setupDependencies,
    onStatus,
    onWarning,
  );
  if (liveKit === undefined) {
    onStatus(
      'Credential setup deferred. Run create-spatius-app setup . --interactive from your project when ready.',
    );
    return 'unchanged';
  }
  redactor.add(liveKit.apiKey, liveKit.apiSecret);
  const spatius = await collectSpatiusCredentials(
    prompts,
    projectName ?? basename(targetDirectory),
    setupDependencies.createSpatiusClient(),
    setupDependencies,
    redactor,
    onStatus,
    onWarning,
  );
  redactor.add(spatius.apiKey);
  const existingVoice = parseDotenv(state.worker ?? '').get(
    'CARTESIA_VOICE_ID',
  );
  const initialVoice =
    CHARACTER_VOICES.find((voice) => voice.voiceId === existingVoice) ??
    CHARACTER_VOICES[0];
  const characterStyle = await prompts.choose(
    'Which character style should the voice match for your selected avatar?',
    CHARACTER_VOICES.map(({ value, label, hint }) => ({ value, label, hint })),
    initialVoice.value,
  );
  const voice = CHARACTER_VOICES.find(
    (option) => option.value === characterStyle,
  );
  if (!voice)
    throw new Error('Choose a feminine or masculine character voice.');
  const credentials: CredentialBundle = validateCredentialBundle({
    voiceId: voice.voiceId,
    liveKit,
    spatius,
  });
  const examples = await readExamples(targetDirectory);
  const rendered = buildCredentialFileContents(state, examples, credentials);
  await writeFiles(targetDirectory, rendered);
  onStatus('Saved .dev.vars and agent/.env.local for local development only.');
  return 'configured';
}

export type { SpatiusCallbackServer };

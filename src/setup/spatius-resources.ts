import { PromptCancelledError } from '../errors.js';
import type { SetupPrompts } from '../prompts.js';
import { type SpatiusCredentials, isPlaceholderValue } from './environment.js';
import { maskSecret, SecretRedactor } from './redaction.js';
import {
  type SpatiusApiKey,
  type SpatiusApp,
  type SpatiusAvatar,
  SpatiusApiClient,
  SpatiusAuthenticatedSession,
} from './spatius-api.js';

export function combineAvatars(
  publicAvatars: readonly SpatiusAvatar[],
  personalAvatars: readonly SpatiusAvatar[],
): SpatiusAvatar[] {
  const byId = new Map<string, SpatiusAvatar>();
  for (const avatar of publicAvatars) {
    byId.set(avatar.id, avatar);
  }
  for (const avatar of personalAvatars) {
    byId.set(avatar.id, { ...byId.get(avatar.id), ...avatar });
  }
  return [...byId.values()];
}

function dateLabel(value: string | undefined): string {
  if (value === undefined) return 'creation date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'creation date unavailable'
    : `created ${date.toISOString().slice(0, 10)}`;
}

export function apiKeyLabel(key: SpatiusApiKey): string {
  return `${maskSecret(key.apiKey)} · ${dateLabel(key.createdAt)}`;
}

function assertResourceId(value: string, label: string): string {
  const normalized = value.trim();
  if (isPlaceholderValue(normalized)) {
    throw new Error(`${label} must be a non-placeholder value.`);
  }
  return normalized;
}

interface SelectedAppKey {
  apiKey: string;
  app: SpatiusApp;
}

async function createApiKey(
  session: SpatiusAuthenticatedSession,
  client: SpatiusApiClient,
  app: SpatiusApp,
  prompts: SetupPrompts,
  redactor: SecretRedactor,
): Promise<SelectedAppKey> {
  const confirmed = await prompts.confirm(
    `Create a new API key for ${app.name} (${app.appId})?`,
    false,
  );
  if (!confirmed) {
    throw new PromptCancelledError('Credential setup was cancelled.');
  }
  const key = await session.authorized((accessToken) =>
    client.createApiKey(accessToken, app.appId),
  );
  redactor.add(key.apiKey);
  return { apiKey: key.apiKey, app };
}

async function selectExistingAppKey(
  session: SpatiusAuthenticatedSession,
  client: SpatiusApiClient,
  app: SpatiusApp,
  prompts: SetupPrompts,
  redactor: SecretRedactor,
): Promise<SelectedAppKey> {
  const keys = await session.authorized((accessToken) =>
    client.listApiKeys(accessToken, app.appId),
  );
  redactor.add(...keys.map((key) => key.apiKey));
  const options = [
    ...keys.map((key, index) => ({
      label: apiKeyLabel(key),
      value: `key-${String(index)}`,
    })),
    {
      hint: 'Creates a new secret after confirmation',
      label: 'Create a new API key for this app',
      value: 'create-key',
    },
  ];
  const selection = await prompts.choose(
    `Which API key should ${app.name} use?`,
    options,
    keys.length > 0 ? 'key-0' : 'create-key',
  );
  if (selection === 'create-key') {
    return createApiKey(session, client, app, prompts, redactor);
  }
  const index = Number.parseInt(selection.slice('key-'.length), 10);
  const key = keys[index];
  if (key === undefined) {
    throw new Error('The selected Spatius API key is no longer available.');
  }
  return { apiKey: key.apiKey, app };
}

async function createAppAndKey(
  session: SpatiusAuthenticatedSession,
  client: SpatiusApiClient,
  projectName: string,
  prompts: SetupPrompts,
  redactor: SecretRedactor,
): Promise<SelectedAppKey> {
  const requestedName = await prompts.input('Name for the new Spatius app', {
    initialValue: projectName,
    placeholder: projectName,
  });
  const name = requestedName.trim();
  if (name === '' || name.length > 128) {
    throw new Error(
      'The Spatius app name must be between 1 and 128 characters.',
    );
  }
  const confirmed = await prompts.confirm(
    `Create the Spatius app "${name}" and its first API key?`,
    false,
  );
  if (!confirmed) {
    throw new PromptCancelledError('Credential setup was cancelled.');
  }

  const app = await session.authorized((accessToken) =>
    client.createApp(accessToken, name),
  );
  try {
    const key = await session.authorized((accessToken) =>
      client.createApiKey(accessToken, app.appId),
    );
    redactor.add(key.apiKey);
    return { apiKey: key.apiKey, app };
  } catch (error) {
    throw new Error(
      `The Spatius app was created with ID ${app.appId}, but its API key could not be created. Rerun setup and select that app to create a key.`,
      { cause: error },
    );
  }
}

async function selectAppAndKey(
  session: SpatiusAuthenticatedSession,
  client: SpatiusApiClient,
  apps: readonly SpatiusApp[],
  projectName: string,
  prompts: SetupPrompts,
  redactor: SecretRedactor,
): Promise<SelectedAppKey> {
  const options = [
    ...apps.map((app, index) => ({
      hint: app.appId,
      label: app.name,
      value: `app-${String(index)}`,
    })),
    {
      hint: 'Creates remote resources only after confirmation',
      label: 'Create a new Spatius app and API key',
      value: 'create-app',
    },
  ];
  const selection = await prompts.choose(
    'Which Spatius app should this project use?',
    options,
    apps.length > 0 ? 'app-0' : 'create-app',
  );
  if (selection === 'create-app') {
    return createAppAndKey(session, client, projectName, prompts, redactor);
  }
  const index = Number.parseInt(selection.slice('app-'.length), 10);
  const app = apps[index];
  if (app === undefined) {
    throw new Error('The selected Spatius app is no longer available.');
  }
  return selectExistingAppKey(session, client, app, prompts, redactor);
}

async function selectAvatar(
  publicAvatars: readonly SpatiusAvatar[],
  personalAvatars: readonly SpatiusAvatar[],
  prompts: SetupPrompts,
): Promise<Pick<SpatiusCredentials, 'avatarId' | 'backgroundUrl'>> {
  const avatars = combineAvatars(publicAvatars, personalAvatars);
  const options = [
    ...avatars.map((avatar, index) => ({
      hint: avatar.id,
      label: `${avatar.name} (${avatar.source})`,
      value: `avatar-${String(index)}`,
    })),
    {
      hint: 'Use an avatar ID not shown in the lists',
      label: 'Enter an avatar ID manually',
      value: 'manual-avatar',
    },
  ];
  const selection = await prompts.choose(
    'Which avatar should the demo dispatch?',
    options,
    avatars.length > 0 ? 'avatar-0' : 'manual-avatar',
  );
  if (selection === 'manual-avatar') {
    return {
      avatarId: assertResourceId(
        await prompts.input('Spatius avatar ID'),
        'SPATIUS_AVATAR_ID',
      ),
    };
  }
  const index = Number.parseInt(selection.slice('avatar-'.length), 10);
  const avatar = avatars[index];
  if (avatar === undefined) {
    throw new Error('The selected Spatius avatar is no longer available.');
  }
  return {
    avatarId: avatar.id,
    ...(avatar.backgroundUrl ? { backgroundUrl: avatar.backgroundUrl } : {}),
  };
}

interface SelectSpatiusResourcesOptions {
  client: SpatiusApiClient;
  onWarning: (message: string) => void;
  projectName: string;
  prompts: SetupPrompts;
  redactor: SecretRedactor;
  session: SpatiusAuthenticatedSession;
}

export async function selectSpatiusResources({
  client,
  onWarning,
  projectName,
  prompts,
  redactor,
  session,
}: SelectSpatiusResourcesOptions): Promise<SpatiusCredentials> {
  const [apps, publicAvatars] = await session.authorized((accessToken) =>
    Promise.all([
      client.listApps(accessToken),
      client.listPublicAvatars(accessToken),
    ]),
  );
  const selected = await selectAppAndKey(
    session,
    client,
    apps,
    projectName,
    prompts,
    redactor,
  );
  let personalAvatars: SpatiusAvatar[] = [];
  try {
    personalAvatars = await client.listPersonalAvatars(
      selected.app.appId,
      selected.apiKey,
    );
  } catch {
    onWarning(
      'Personal avatars could not be loaded; continuing with the public avatar library.',
    );
  }
  const avatar = await selectAvatar(publicAvatars, personalAvatars, prompts);

  return {
    apiKey: selected.apiKey,
    appId: selected.app.appId,
    ...avatar,
  };
}

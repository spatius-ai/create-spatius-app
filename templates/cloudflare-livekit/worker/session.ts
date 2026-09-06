import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from 'livekit-server-sdk';

import { serializeAgentDispatchMetadata } from './dispatch-metadata.js';

const TOKEN_TTL = '10m';
const REQUIRED_ENVIRONMENT_KEYS = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_AGENT_NAME',
  'SPATIUS_APP_ID',
  'SPATIUS_AVATAR_ID',
] as const;

export interface SessionResponse {
  participant_token: string;
  room_name: string;
  server_url: string;
  spatius_app_id: string;
  spatius_avatar_id: string;
  spatius_avatar_background_url?: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function requireConfiguration(env: CloudflareBindings): void {
  for (const key of REQUIRED_ENVIRONMENT_KEYS) {
    const value = env[key];

    if (typeof value !== 'string' || value.trim() === '') {
      throw new ConfigurationError(`Missing required configuration: ${key}`);
    }
  }

  let livekitUrl: URL;
  try {
    livekitUrl = new URL(env.LIVEKIT_URL);
  } catch {
    throw new ConfigurationError('LIVEKIT_URL must be a valid URL.');
  }

  if (!['wss:', 'https:'].includes(livekitUrl.protocol)) {
    throw new ConfigurationError('LIVEKIT_URL must use wss:// or https://.');
  }
}

export async function createSession(
  env: CloudflareBindings,
  randomUUID: () => string = () => crypto.randomUUID(),
): Promise<SessionResponse> {
  requireConfiguration(env);

  const avatarId = env.SPATIUS_AVATAR_ID.trim();
  const roomName = `spatius-${randomUUID()}`;
  const participantIdentity = `web-${randomUUID()}`;
  const accessToken = new AccessToken(
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
    {
      identity: participantIdentity,
      ttl: TOKEN_TTL,
    },
  );

  accessToken.addGrant({
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    room: roomName,
    roomJoin: true,
  });
  accessToken.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: env.LIVEKIT_AGENT_NAME,
        metadata: serializeAgentDispatchMetadata(
          avatarId,
          env.CARTESIA_VOICE_ID,
        ),
      }),
    ],
  });

  return {
    participant_token: await accessToken.toJwt(),
    room_name: roomName,
    server_url: env.LIVEKIT_URL,
    spatius_app_id: env.SPATIUS_APP_ID,
    spatius_avatar_id: avatarId,
    ...(env.SPATIUS_AVATAR_BACKGROUND_URL
      ? { spatius_avatar_background_url: env.SPATIUS_AVATAR_BACKGROUND_URL }
      : {}),
  };
}

import { randomInt, randomUUID } from 'node:crypto';
import agoraToken from 'agora-token';
const { RtcTokenBuilder, RtcRole } = agoraToken;
import { signCapability, verifyCapability } from './capability.js';
export type AgoraEnvironment = CloudflareBindings;
export class ConfigurationError extends Error {}
function configuration(env: AgoraEnvironment) {
  for (const key of [
    'AGORA_APP_ID',
    'AGORA_APP_CERTIFICATE',
    'AGORA_PIPELINE_ID',
    'SPATIUS_APP_ID',
    'SPATIUS_API_KEY',
    'SPATIUS_AVATAR_ID',
  ] as const)
    if (!env[key] || env[key].startsWith('your-'))
      throw new ConfigurationError(`Missing ${key}`);
  if (
    !/^[a-f\d]{32}$/i.test(env.AGORA_APP_ID) ||
    !/^[a-f\d]{32}$/i.test(env.AGORA_APP_CERTIFICATE)
  )
    throw new ConfigurationError(
      'Agora App ID and certificate must be 32 hexadecimal characters.',
    );
  const rate = Number(env.AGORA_AVATAR_SAMPLE_RATE ?? 24000);
  if (![8000, 16000, 22050, 24000, 32000, 44100, 48000].includes(rate))
    throw new ConfigurationError('Unsupported avatar sample rate.');
  return rate;
}
function rtcToken(
  env: AgoraEnvironment,
  channel: string,
  uid: number,
  seconds = 1800,
) {
  return RtcTokenBuilder.buildTokenWithUid(
    env.AGORA_APP_ID,
    env.AGORA_APP_CERTIFICATE,
    channel,
    uid,
    RtcRole.PUBLISHER,
    seconds,
    seconds,
  );
}
async function upstream(
  env: AgoraEnvironment,
  path: string,
  body?: object,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `https://api.agora.io/api/conversational-ai-agent/v2/projects/${env.AGORA_APP_ID}/${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `agora token="${rtcToken(env, '', 1, 300)}"`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (path.endsWith('/leave') && response.status === 404) return {};
  if (!response.ok)
    throw new Error(
      `Agora request failed (${response.status}). Check the published pipeline and project configuration.`,
    );
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}
export async function createAgoraSession(
  env: AgoraEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const sampleRate = configuration(env);
  const channel = `spatius-${randomUUID().replaceAll('-', '')}`;
  const uid = randomInt(100000, 599999),
    agentUid = randomInt(600000, 799999),
    avatarUid = randomInt(800000, 999999);
  const response = await upstream(
    env,
    'join',
    {
      name: channel,
      pipeline_id: env.AGORA_PIPELINE_ID,
      properties: {
        channel,
        agent_rtc_uid: String(agentUid),
        token: rtcToken(env, channel, agentUid),
        remote_rtc_uids: [String(uid)],
        idle_timeout: 60,
        advanced_features: { enable_rtm: true },
        parameters: { data_channel: 'rtm', enable_error_message: true },
        avatar: {
          enable: true,
          vendor: 'spatius',
          params: {
            spatius_api_key: env.SPATIUS_API_KEY,
            spatius_app_id: env.SPATIUS_APP_ID,
            spatius_avatar_id: env.SPATIUS_AVATAR_ID,
            agora_uid: String(avatarUid),
            agora_token: rtcToken(env, channel, avatarUid),
            region: env.SPATIUS_REGION ?? 'cn-beijing',
            sample_rate: sampleRate,
            session_expire_minutes: 30,
          },
        },
      },
    },
    fetcher,
  );
  if (typeof response.agent_id !== 'string' || !response.agent_id)
    throw new Error('Agora returned an invalid session.');
  const capability = await signCapability(
    env.AGORA_APP_CERTIFICATE,
    { purpose: 'agora-session', agent: response.agent_id },
    3600,
  );
  return {
    capability,
    appId: env.AGORA_APP_ID,
    channel,
    uid,
    agentUid,
    token: RtcTokenBuilder.buildTokenWithRtm(
      env.AGORA_APP_ID,
      env.AGORA_APP_CERTIFICATE,
      channel,
      String(uid),
      RtcRole.PUBLISHER,
      1800,
      1800,
    ),
    spatiusAppId: env.SPATIUS_APP_ID,
    avatarId: env.SPATIUS_AVATAR_ID,
    region: env.SPATIUS_REGION ?? 'cn-beijing',
  };
}
export async function stopAgoraSession(
  env: AgoraEnvironment,
  capability: string,
  fetcher: typeof fetch = fetch,
) {
  const claims = await verifyCapability(
    env.AGORA_APP_CERTIFICATE,
    capability,
    'agora-session',
  );
  if (typeof claims.agent !== 'string') throw new Error('Invalid session');
  await upstream(
    env,
    `agents/${encodeURIComponent(claims.agent)}/leave`,
    {},
    fetcher,
  );
}

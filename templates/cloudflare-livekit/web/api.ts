export interface VoiceSession {
  session_capability?: string;
  participant_token: string;
  room_name: string;
  server_url: string;
  spatius_app_id: string;
  spatius_avatar_id: string;
  spatius_avatar_background_url?: string;
}

function isVoiceSession(value: unknown): value is VoiceSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return [
    'participant_token',
    'room_name',
    'server_url',
    'spatius_app_id',
    'spatius_avatar_id',
  ].every((key) => typeof candidate[key] === 'string' && candidate[key] !== '');
}

export async function requestVoiceSession(
  signal?: AbortSignal,
): Promise<VoiceSession> {
  const response = await fetch('/api/session', {
    signal,
    cache: 'no-store',
    headers: { accept: 'application/json' },
    method: 'POST',
  });
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Could not start a voice session.';

    throw new Error(message);
  }

  if (!isVoiceSession(payload)) {
    throw new Error('The session endpoint returned an invalid response.');
  }

  // Presentation metadata is optional: older projects and manual avatar IDs work.
  const background = payload.spatius_avatar_background_url;
  if (background !== undefined) {
    try {
      const url = new URL(background);
      if (
        typeof background !== 'string' ||
        url.protocol !== 'https:' ||
        url.username ||
        url.password
      )
        delete payload.spatius_avatar_background_url;
    } catch {
      delete payload.spatius_avatar_background_url;
    }
  }
  return payload;
}

export async function stopVoiceSession(capability?: string): Promise<void> {
  if (!capability) return;
  const response = await fetch('/api/session/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability }),
    keepalive: true,
  });
  if (!response.ok) throw new Error('Session cleanup failed');
}

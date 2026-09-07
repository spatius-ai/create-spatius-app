import { describe, expect, it, vi } from 'vitest';
import {
  createAgoraSession,
  stopAgoraSession,
  type AgoraEnvironment,
} from './agora.js';
const env: AgoraEnvironment = {
  AGORA_APP_ID: 'a'.repeat(32),
  AGORA_APP_CERTIFICATE: 'b'.repeat(32),
  AGORA_PIPELINE_ID: 'test-pipeline',
  SPATIUS_API_KEY: 'private-key',
  SPATIUS_APP_ID: 'test-app',
  SPATIUS_AVATAR_ID: 'test-avatar',
};
describe('hosted Agora sessions', () => {
  it('keeps secrets server-side and authorizes idempotent cleanup', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ agent_id: 'hosted-agent' }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const session = await createAgoraSession(env, fetcher);
    expect(session.uid).not.toBe(session.agentUid);
    expect(JSON.stringify(session)).not.toContain(env.AGORA_APP_CERTIFICATE);
    expect(JSON.stringify(session)).not.toContain(env.SPATIUS_API_KEY);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string) as {
      pipeline_id: string;
      properties: {
        agent_rtc_uid: string;
        remote_rtc_uids: string[];
        avatar: { params: { agora_uid: string; sample_rate: number } };
      };
    };
    expect(body.pipeline_id).toBe('test-pipeline');
    expect(body.properties.remote_rtc_uids).toEqual([String(session.uid)]);
    expect(body.properties.agent_rtc_uid).toBe(String(session.agentUid));
    expect(body.properties.avatar.params.agora_uid).not.toBe(
      String(session.uid),
    );
    expect(body.properties.avatar.params.sample_rate).toBe(24000);
    await stopAgoraSession(env, session.capability, fetcher);
    expect(fetcher.mock.calls[1][0]).toContain('/agents/hosted-agent/leave');
    await expect(
      stopAgoraSession(env, session.capability + 'bad', fetcher),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('validates configuration before starting a billable agent and redacts upstream errors', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createAgoraSession({ ...env, AGORA_AVATAR_SAMPLE_RATE: '123' }, fetcher),
    ).rejects.toThrow('sample rate');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(
      Response.json({ error: env.SPATIUS_API_KEY }, { status: 400 }),
    );
    await expect(createAgoraSession(env, fetcher)).rejects.toThrow(
      'Agora request failed (400)',
    );
  });
});

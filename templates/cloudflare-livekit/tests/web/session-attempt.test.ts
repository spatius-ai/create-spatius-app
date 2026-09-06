import { describe, expect, it, vi } from 'vitest';
import type { Room } from 'livekit-client';
import {
  SessionAttempt,
  type AttemptDependencies,
} from '../../web/session-attempt.js';
import type { VoiceSession } from '../../web/api.js';

const credentials: VoiceSession = {
  server_url: 'wss://example.invalid',
  participant_token: 'one-attempt',
  room_name: 'room-one',
  spatius_app_id: 'app',
  spatius_avatar_id: 'avatar',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides: Partial<AttemptDependencies> = {}) {
  const stop = vi.fn();
  const microphone = vi.fn().mockResolvedValue({ track: { stop } });
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const room = {
    disconnect,
    localParticipant: { setMicrophoneEnabled: microphone },
  } as unknown as Room;
  const dispose = vi.fn().mockResolvedValue(undefined);
  const deps: AttemptDependencies = {
    createRoom: () => room,
    request: vi.fn().mockResolvedValue(credentials),
    attach: vi.fn().mockResolvedValue({ dispose }),
    ...overrides,
  };
  return {
    attempt: new SessionAttempt(deps),
    deps,
    room,
    dispose,
    disconnect,
    microphone,
    stop,
  };
}
const container = {} as HTMLElement;
describe('per-attempt lifecycle', () => {
  it('has no bootstrap side effects until prepare, and literal fetch never repeats the POST', async () => {
    const { attempt, deps, room } = setup();
    expect(deps.request).not.toHaveBeenCalled();
    const prepared = await attempt.prepare(container, vi.fn());
    expect(deps.attach).toHaveBeenCalledWith(
      container,
      credentials,
      room,
      attempt.abort.signal,
      expect.any(Function),
    );
    await prepared.tokenSource.fetch();
    await prepared.tokenSource.fetch();
    expect(deps.request).toHaveBeenCalledTimes(1);
    await attempt.dispose();
  });
  it('aborts the request and never attaches when a cancelled request resolves late', async () => {
    const request = deferred<VoiceSession>();
    const { attempt, deps } = setup({ request: () => request.promise });
    const pending = attempt.prepare(container, vi.fn());
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await attempt.dispose();
    request.resolve(credentials);
    await rejected;
    expect(deps.attach).not.toHaveBeenCalled();
    expect(attempt.abort.signal.aborted).toBe(true);
  });
  it('cleans an avatar that becomes ready after cancellation and disposes the room once', async () => {
    const attach = deferred<{ dispose: () => Promise<void> }>();
    const { attempt, disconnect } = setup({ attach: () => attach.promise });
    const pending = attempt.prepare(container, vi.fn());
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await Promise.resolve();
    await attempt.dispose();
    await attempt.dispose();
    const dispose = vi.fn().mockResolvedValue(undefined);
    attach.resolve({ dispose });
    await rejected;
    expect(dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('continues room cleanup if avatar disposal rejects', async () => {
    const { attempt, dispose, disconnect } = setup();
    await attempt.prepare(container, vi.fn());
    dispose.mockRejectedValueOnce(new Error('renderer already gone'));
    await expect(attempt.dispose()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('stops a microphone track returned after the user ended the call', async () => {
    const { attempt, microphone, stop } = setup();
    const publication = deferred<{ track: { stop: () => void } }>();
    microphone.mockReturnValueOnce(publication.promise);
    const pending = attempt.setMicrophone(true);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await attempt.dispose();
    publication.resolve({ track: { stop } });
    await rejected;
    expect(stop).toHaveBeenCalledOnce();
    expect(microphone).toHaveBeenLastCalledWith(false);
  });
  it('uses fresh credentials and a fresh room for retry', async () => {
    const first = setup();
    await first.attempt.prepare(container, vi.fn());
    await first.attempt.dispose();
    const second = setup({
      request: vi
        .fn()
        .mockResolvedValue({ ...credentials, participant_token: 'new-token' }),
    });
    const prepared = await second.attempt.prepare(container, vi.fn());
    expect(second.room).not.toBe(first.room);
    expect(await prepared.tokenSource.fetch()).toMatchObject({
      participantToken: 'new-token',
    });
    await second.attempt.dispose();
  });
  it('stops the replacement microphone when device switching resolves after End', async () => {
    const { attempt, room, disconnect } = setup();
    const stop = vi.fn();
    room.localParticipant.getTrackPublication = vi
      .fn()
      .mockReturnValue({ track: { stop } });
    const switching = deferred<void>();
    const pending = attempt.switchMicrophoneDevice(() => switching.promise);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await attempt.dispose();
    switching.resolve();
    await rejected;
    expect(stop).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });
});

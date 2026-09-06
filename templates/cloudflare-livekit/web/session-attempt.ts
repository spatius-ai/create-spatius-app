import { Room, TokenSource, Track } from 'livekit-client';
import { requestVoiceSession, type VoiceSession } from './api.js';
import type { AvatarSessionController } from './avatar-session.js';

export type PreparedSession = {
  attempt: SessionAttempt;
  tokenSource: ReturnType<typeof TokenSource.literal>;
};
export interface AttemptDependencies {
  createRoom: () => Room;
  request: (signal: AbortSignal) => Promise<VoiceSession>;
  attach: (
    container: HTMLElement,
    credentials: VoiceSession,
    room: Room,
    signal: AbortSignal,
    report: (status: string) => void,
  ) => Promise<AvatarSessionController>;
}
const dependencies: AttemptDependencies = {
  createRoom: () => new Room({ singlePeerConnection: false }),
  request: requestVoiceSession,
  attach: async (...args) => {
    const { attachAvatarSession } = await import('./avatar-session.js');
    return attachAvatarSession(...args);
  },
};

export class SessionAttempt {
  stage: 'bootstrap' | 'avatar' = 'bootstrap';
  readonly room: Room;
  readonly abort = new AbortController();
  private avatar?: AvatarSessionController;
  private disposal?: Promise<void>;
  constructor(private readonly deps: AttemptDependencies = dependencies) {
    this.room = deps.createRoom();
  }
  async prepare(
    container: HTMLElement,
    report: (status: string) => void,
  ): Promise<PreparedSession> {
    const { signal } = this.abort;
    const credentials = await this.deps.request(signal);
    signal.throwIfAborted();
    // Warm LiveKit's region selection and connection while the avatar loads.
    // This does not join the room or acquire media; attach must still finish
    // before useSession starts the connection. A failed warmup is non-fatal.
    void this.room
      .prepareConnection(credentials.server_url, credentials.participant_token)
      .catch(() => undefined);
    this.stage = 'avatar';
    const avatar = await this.deps.attach(
      container,
      credentials,
      this.room,
      signal,
      report,
    );
    if (signal.aborted) {
      await avatar.dispose();
      signal.throwIfAborted();
    }
    this.avatar = avatar;
    return {
      attempt: this,
      tokenSource: TokenSource.literal({
        serverUrl: credentials.server_url,
        participantToken: credentials.participant_token,
      }),
    };
  }
  async setMicrophone(enabled: boolean): Promise<void> {
    this.abort.signal.throwIfAborted();
    const publication =
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
    if (this.abort.signal.aborted) {
      // A pending permission prompt may finish after End. Stop its late track too.
      publication?.track?.stop();
      await this.room.localParticipant.setMicrophoneEnabled(false);
      this.abort.signal.throwIfAborted();
    }
  }
  async switchMicrophoneDevice(
    switchDevice: () => Promise<void>,
  ): Promise<void> {
    this.abort.signal.throwIfAborted();
    try {
      await switchDevice();
    } finally {
      if (this.abort.signal.aborted) {
        // Switching can replace the track; inspect the current publication, not a render snapshot.
        this.room.localParticipant
          .getTrackPublication(Track.Source.Microphone)
          ?.track?.stop();
        await this.room.disconnect(true);
      }
    }
    this.abort.signal.throwIfAborted();
  }
  dispose(): Promise<void> {
    this.abort.abort();
    this.disposal ??= (async () => {
      await Promise.allSettled([
        this.room.disconnect(true),
        this.avatar?.dispose() ?? Promise.resolve(),
      ]);
    })();
    return this.disposal;
  }
}

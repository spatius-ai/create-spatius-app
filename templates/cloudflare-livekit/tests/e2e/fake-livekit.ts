import type { TranscriptMessage } from '../../web/components/agents-ui/agent-chat-transcript.js';

declare global {
  interface Window {
    __fixture: {
      events: string[];
      failMicrophone: boolean;
      failSend: boolean;
      stallConnect: boolean;
      pendingAgent: boolean;
      blockedAudio: boolean;
      messages: TranscriptMessage[];
    };
  }
}
window.__fixture = {
  events: [],
  failMicrophone: false,
  failSend: false,
  stallConnect: false,
  pendingAgent: false,
  blockedAudio: false,
  messages: [],
};
export const ConnectionState = {
  Disconnected: 'disconnected',
  Connected: 'connected',
  Reconnecting: 'reconnecting',
  SignalReconnecting: 'signalReconnecting',
  Connecting: 'connecting',
} as const;
export const RoomEvent = { Disconnected: 'disconnected' } as const;
export const Track = { Source: { Microphone: 'microphone' } } as const;
export class Room {
  private listeners = new Map<string, Set<() => void>>();
  state: string = ConnectionState.Disconnected;
  audioUnlocked = false;
  activeDeviceId = 'default';
  localParticipant = {
    identity: 'local',
    isLocal: true,
    isMicrophoneEnabled: false,
    getTrackPublication: () => ({
      track: {
        stop: () => {
          this.localParticipant.isMicrophoneEnabled = false;
        },
      },
    }),
    setMicrophoneEnabled: async (enabled: boolean) => {
      window.__fixture.events.push(`microphone:${enabled}`);
      if (enabled && window.__fixture.failMicrophone)
        throw new DOMException('denied', 'NotAllowedError');
      this.localParticipant.isMicrophoneEnabled = enabled;
      this.update();
      await Promise.resolve();
      return {
        track: {
          stop: () => {
            this.localParticipant.isMicrophoneEnabled = false;
            window.__fixture.events.push('track:stop');
            this.update();
          },
        },
      };
    },
  };
  constructor(options: { singlePeerConnection: boolean }) {
    window.__fixture.events.push(`room:${options.singlePeerConnection}`);
    window.addEventListener('fixture:disconnect', () => {
      void this.disconnect();
    });
    window.addEventListener('fixture:reconnecting', () => {
      this.state = ConnectionState.Reconnecting;
      this.update();
    });
    window.addEventListener('fixture:reconnected', () => {
      this.state = ConnectionState.Connected;
      this.update();
    });
  }
  update() {
    window.dispatchEvent(new Event('fixture:update'));
  }
  on(event: string, callback: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(callback);
    this.listeners.set(event, listeners);
    return this;
  }
  off(event: string, callback: () => void) {
    this.listeners.get(event)?.delete(callback);
    return this;
  }
  async connect() {
    window.__fixture.events.push('room:connect');
    if (window.__fixture.stallConnect) await new Promise<void>(() => undefined);
    this.state = ConnectionState.Connected;
    this.update();
  }
  async disconnect() {
    window.__fixture.events.push('room:disconnect');
    this.localParticipant.isMicrophoneEnabled = false;
    this.state = ConnectionState.Disconnected;
    this.listeners.get('disconnected')?.forEach((callback) => callback());
    this.update();
    await Promise.resolve();
  }
  async startAudio() {
    if (!window.__fixture.blockedAudio) this.audioUnlocked = true;
    this.update();
    await Promise.resolve();
  }
}
export const TokenSource = {
  literal: (credentials: { serverUrl: string; participantToken: string }) => ({
    fetch: () => Promise.resolve(credentials),
  }),
};

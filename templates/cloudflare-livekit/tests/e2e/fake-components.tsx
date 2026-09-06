import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  ReceivedMessage,
  UseSessionReturn,
} from '@livekit/components-react';
import { Room, ConnectionState } from './fake-livekit.js';

function useUpdates() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener('fixture:update', update);
    return () => window.removeEventListener('fixture:update', update);
  }, []);
  return revision;
}
type FixtureSession = {
  room: Room;
  start: () => Promise<void>;
  end: () => Promise<void>;
  isConnected: boolean;
  connectionState: string;
};
const Context = createContext<FixtureSession | null>(null);
export function useSession(
  tokenSource: { fetch: () => Promise<unknown> },
  options: { room: Room },
) {
  useUpdates();
  const { room } = options;
  useEffect(() => {
    void tokenSource.fetch();
  }, [tokenSource]);
  const actions = useMemo(
    () => ({
      start: async () => {
        await tokenSource.fetch();
        await room.connect();
      },
      end: async () => {
        await tokenSource.fetch();
        await room.disconnect();
      },
    }),
    [room, tokenSource],
  );
  return {
    ...actions,
    room,
    connectionState: room.state,
    isConnected: room.state === ConnectionState.Connected,
  } as unknown as UseSessionReturn;
}
export function SessionProvider({
  session,
  children,
}: {
  session: FixtureSession;
  children: ReactNode;
}) {
  return <Context value={session}>{children}</Context>;
}
export function useSessionContext() {
  const session = useContext(Context);
  if (!session) throw new Error('missing context');
  return session;
}
export function RoomAudioRenderer() {
  return <audio data-testid="remote-audio-renderer" />;
}
export function useAgent() {
  const session = useSessionContext();
  return {
    name: 'Test agent',
    internal: { agentParticipant: null, workerParticipant: null },
    state:
      session.connectionState === ConnectionState.Reconnecting
        ? 'disconnected'
        : session.isConnected
          ? window.__fixture.pendingAgent
            ? 'initializing'
            : 'listening'
          : 'connecting',
  };
}
export function useLocalParticipant({ room }: { room: Room }) {
  useUpdates();
  return {
    isMicrophoneEnabled: room.localParticipant.isMicrophoneEnabled,
    microphoneTrack: undefined,
  };
}
export function useMultibandTrackVolume() {
  useUpdates();
  const session = useSessionContext();
  return session.room.localParticipant.isMicrophoneEnabled
    ? [0.2, 0.6, 0.9, 0.5, 0.3]
    : [0, 0, 0, 0, 0];
}
export function useMediaDeviceSelect({ room }: { room: Room }) {
  useUpdates();
  return {
    devices: [
      { deviceId: 'default', label: 'Default microphone' },
      { deviceId: 'headset', label: 'Headset microphone' },
    ],
    activeDeviceId: room.activeDeviceId,
    setActiveMediaDevice: async (id: string) => {
      room.activeDeviceId = id;
      window.__fixture.events.push(`device:${id}`);
      room.update();
      await Promise.resolve();
    },
  };
}
export function useStartAudio({ room }: { room: Room }) {
  useUpdates();
  return {
    mergedProps: {
      style: { display: room.audioUnlocked ? 'none' : 'inline-flex' },
      onClick: () => {
        window.__fixture.blockedAudio = false;
        void room.startAudio();
      },
    },
  };
}
export function useSessionMessages() {
  useUpdates();
  const session = useSessionContext();
  const [sending, setSending] = useState(false);
  const messages = useMemo(
    () =>
      window.__fixture.messages.map(({ isUser, ...message }) => ({
        ...message,
        type: isUser ? 'userTranscript' : 'agentTranscript',
        from: isUser ? session.room.localParticipant : undefined,
      })) as ReceivedMessage[],
    [window.__fixture.messages, session.room],
  );
  return {
    messages,
    isSending: sending,
    send: async (message: string) => {
      setSending(true);
      try {
        if (window.__fixture.failSend) throw new Error('send failed');
        const id = String(window.__fixture.messages.length);
        window.__fixture.messages = [
          ...window.__fixture.messages,
          { id: `user-${id}`, timestamp: Date.now(), message, isUser: true },
          {
            id: `agent-${id}`,
            timestamp: Date.now(),
            message: 'I hear you.',
            isUser: false,
          },
        ];
        window.dispatchEvent(new Event('fixture:update'));
        await Promise.resolve();
      } finally {
        setSending(false);
      }
    },
  };
}

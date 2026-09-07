import { ScenarioPanel } from './scenario-panel.js';
import type { ConversationControls } from '../scenario.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, Track } from 'livekit-client';
import {
  useAgent,
  useLocalParticipant,
  useMediaDeviceSelect,
  useSession,
  useSessionMessages,
} from '@livekit/components-react';
import type { PreparedSession } from '../session-attempt.js';
import { AgentSessionProvider } from './agents-ui/agent-session-provider.js';
import { AgentTrackToggle } from './agents-ui/agent-track-toggle.js';
import { AgentDisconnectButton } from './agents-ui/agent-disconnect-button.js';
import { AgentChatInput } from './agents-ui/agent-chat-input.js';
import {
  AgentChatTranscript,
  snapshotMessages,
  type ConversationParticipants,
  type TranscriptMessage,
} from './agents-ui/agent-chat-transcript.js';
import { StartAudioButton } from './agents-ui/start-audio-button.js';
import { AgentAudioVisualizerBar } from './agents-ui/agent-audio-visualizer-bar.js';
import { TranscriptPanel } from './transcript-panel.js';

export type ConversationEnd = {
  messages: TranscriptMessage[];
  agentName: string;
  error?: string;
};
type Props = {
  prepared: PreparedSession;
  onEnd: (result: ConversationEnd) => void;
};

export function Conversation({ prepared, onEnd }: Props) {
  const { attempt, tokenSource } = prepared;
  const options = useMemo(
    () => ({ room: attempt.room, agentConnectTimeoutMilliseconds: 30_000 }),
    [attempt],
  );
  const session = useSession(tokenSource, options);
  return (
    <AgentSessionProvider session={session}>
      <ConversationContent
        prepared={prepared}
        onEnd={onEnd}
        session={session}
      />
    </AgentSessionProvider>
  );
}

function ConversationContent({
  prepared,
  onEnd,
  session,
}: Props & { session: ReturnType<typeof useSession> }) {
  const { attempt } = prepared;
  const agent = useAgent(session);
  // One subscription owns synchronized speech and typed messages for every view.
  const stream = useSessionMessages(session);
  const participants = useRef<ConversationParticipants>({});
  const previousMessages = useRef<TranscriptMessage[]>([]);
  const agentIdentity = agent.internal.agentParticipant?.identity;
  const avatarIdentity = agent.internal.workerParticipant?.identity;
  // LiveKit identifies the Python agent separately from the participant that
  // publishes avatar media on its behalf. Retain IDs through disconnection.
  if (agentIdentity) participants.current.agentIdentity = agentIdentity;
  if (avatarIdentity) participants.current.avatarIdentity = avatarIdentity;
  const messages = useMemo(
    () =>
      snapshotMessages(
        stream.messages,
        participants.current,
        previousMessages.current,
      ),
    [stream.messages, agentIdentity, avatarIdentity],
  );
  previousMessages.current = messages;
  const agentName = agent.name?.trim() || 'Your agent';
  const latest = useRef({ messages, agentName });
  latest.current = { messages, agentName };
  const [roomReady, setRoomReady] = useState(false);
  const ready =
    roomReady && ['listening', 'thinking', 'speaking'].includes(agent.state);
  const readyRef = useRef(false);
  if (ready) readyRef.current = true;
  const microphoneRequested = useRef(false);
  const [microphonePending, setMicrophonePending] = useState(false);
  const [devicePending, setDevicePending] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const mediaBusy = useRef(false);
  const { isMicrophoneEnabled, microphoneTrack } = useLocalParticipant({
    room: attempt.room,
  });
  // LiveKit rebuilds its device observer when this callback changes. An inline
  // callback would reset the device state on every render and cause a loop.
  const onDeviceError = useCallback(() => {
    if (!attempt.abort.signal.aborted)
      setMediaError(
        'Could not use that microphone. Choose another device or keep typing.',
      );
  }, [attempt]);
  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({
      room: attempt.room,
      kind: 'audioinput',
      requestPermissions: false,
      onError: onDeviceError,
    });
  const toggleMicrophone = async (enabled: boolean) => {
    if (mediaBusy.current || attempt.abort.signal.aborted) return;
    mediaBusy.current = true;
    setMicrophonePending(true);
    setMediaError('');
    try {
      await attempt.setMicrophone(enabled);
    } catch {
      if (!attempt.abort.signal.aborted)
        setMediaError(
          'Microphone unavailable. Allow access and try the microphone again, or continue by typing.',
        );
    } finally {
      mediaBusy.current = false;
      if (!attempt.abort.signal.aborted) setMicrophonePending(false);
    }
  };
  const finish = (error?: string) => onEnd({ ...latest.current, error });
  const startSession = useRef(session.start);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!readyRef.current && !cancelled && !attempt.abort.signal.aborted)
        finishRef.current(
          'Your agent did not join in time. Check that the LiveKit agent is running and try again.',
        );
    }, 32_000);
    // StrictMode rehearses effects. Only its surviving effect starts this attempt.
    queueMicrotask(() => {
      if (cancelled || attempt.abort.signal.aborted) return;
      void startSession
        .current({
          signal: attempt.abort.signal,
          tracks: {
            microphone: { enabled: false },
            camera: { enabled: false },
            screenShare: { enabled: false },
          },
        })
        .then(() => {
          if (cancelled || attempt.abort.signal.aborted) return;
          setRoomReady(true);
        })
        .catch(() => {
          if (!cancelled && !attempt.abort.signal.aborted)
            finishRef.current(
              'Could not connect to your agent. Please try again.',
            );
        });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready || microphoneRequested.current || attempt.abort.signal.aborted)
      return;
    microphoneRequested.current = true;
    void toggleMicrophone(true);
  }, [ready, attempt]);

  useEffect(() => {
    // Snapshot after React commits both the final message and disconnection state.
    if (
      roomReady &&
      session.connectionState === ConnectionState.Disconnected &&
      !attempt.abort.signal.aborted
    ) {
      finishRef.current(
        'The connection ended. You can start a new conversation.',
      );
    }
  }, [roomReady, session.connectionState, attempt]);

  useEffect(() => {
    if (!ready) return;
    const started = Date.now();
    const interval = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [ready]);

  useEffect(() => {
    if (
      roomReady &&
      agent.state === 'failed' &&
      attempt.room.state === ConnectionState.Connected
    )
      finishRef.current(
        'Your agent is unavailable. Check that it is running and try again.',
      );
  }, [agent.state, roomReady, attempt]);

  const reconnecting =
    session.connectionState === ConnectionState.Reconnecting ||
    session.connectionState === ConnectionState.SignalReconnecting;
  const interactive = ready && session.isConnected && !reconnecting;
  const status = reconnecting
    ? 'Reconnecting'
    : !ready
      ? 'Connecting'
      : agent.state === 'speaking'
        ? 'Speaking'
        : agent.state === 'thinking'
          ? 'Thinking'
          : isMicrophoneEnabled
            ? 'Listening'
            : 'Ready to chat';
  const selectableDevices = devices.filter((device) => device.deviceId);
  const send = async (message: string) => {
    attempt.abort.signal.throwIfAborted();
    if (!interactive) throw new Error('Not connected');
    return stream.send(message);
  };

  const controls: ConversationControls = {
    speak: async (text) => {
      await command('say', { text });
    },
    interrupt: async () => {
      await command('interrupt', {});
    },
    setMode: async (mode) => {
      await command('mode', { mode });
    },
  };
  async function command(method: string, payload: object) {
    const participant = agent.internal.agentParticipant;
    if (
      !interactive ||
      !participant ||
      participant.attributes['spatius.ready'] !== '1'
    )
      throw new Error('Agent is not ready');
    await attempt.room.localParticipant.performRpc({
      destinationIdentity: participant.identity,
      method: `spatius.${method}`,
      payload: JSON.stringify(payload),
      responseTimeout: 30,
    });
  }
  return (
    <div className="conversation-ui">
      <ScenarioPanel
        controls={controls}
        ready={
          interactive &&
          agent.internal.agentParticipant?.attributes['spatius.ready'] === '1'
        }
      />
      <header className="session-header">
        <div className="identity-pill">
          <span className="presence-dot" data-live={ready} />
          <div>
            <h1>{agentName}</h1>
            <p role="status">{status} · AI agent</p>
          </div>
          <span
            className="session-timer"
            aria-label="Elapsed conversation time"
          >
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>
      </header>
      {!ready && !reconnecting && (
        <div className="connection-overlay">
          <span className="loading-spinner" aria-hidden="true" />
          <h2>
            {roomReady ? 'Waiting for your agent' : 'Connecting to the room'}
          </h2>
          <p role="status">
            {roomReady
              ? 'Your agent is starting up. This can take a moment.'
              : 'Your avatar is ready. Establishing a secure connection.'}
          </p>
          <button
            className="text-button"
            type="button"
            onClick={() => finish()}
          >
            Cancel
          </button>
        </div>
      )}
      <div className="conversation-tools">
        <StartAudioButton room={attempt.room} />
        <AgentAudioVisualizerBar
          audioTrack={{
            participant: attempt.room.localParticipant,
            source: Track.Source.Microphone,
            publication: microphoneTrack,
          }}
          enabled={interactive && isMicrophoneEnabled}
        />
        <div className="call-dock">
          <AgentTrackToggle
            pressed={isMicrophoneEnabled}
            pending={microphonePending}
            disabled={!interactive}
            onPressedChange={(enabled) => void toggleMicrophone(enabled)}
          />
          <div className="device-select">
            <label className="sr-only" htmlFor="microphone-device">
              Microphone device
            </label>
            <select
              id="microphone-device"
              aria-label="Microphone device"
              value={activeDeviceId || ''}
              disabled={!interactive || microphonePending || devicePending}
              onChange={(event) => {
                const id = event.target.value;
                setDevicePending(true);
                setMediaError('');
                void attempt
                  .switchMicrophoneDevice(() => setActiveMediaDevice(id))
                  .catch(() => {
                    if (!attempt.abort.signal.aborted)
                      setMediaError(
                        'Could not switch microphones. Try another device.',
                      );
                  })
                  .finally(() => {
                    if (!attempt.abort.signal.aborted) setDevicePending(false);
                  });
              }}
            >
              <option value="">Default microphone</option>
              {selectableDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          </div>
          <AgentDisconnectButton
            onClick={(event) => {
              event.preventDefault();
              finish();
            }}
          >
            End call
          </AgentDisconnectButton>
        </div>
        {mediaError && (
          <p className="control-error" role="alert">
            {mediaError}
          </p>
        )}
      </div>
      <TranscriptPanel>
        <AgentChatTranscript
          messages={messages}
          agentState={agent.state}
          agentName={agentName}
        />
        <div className="panel-composer">
          <AgentChatInput
            disabled={!interactive || stream.isSending}
            onSend={send}
          />
        </div>
      </TranscriptPanel>
    </div>
  );
}

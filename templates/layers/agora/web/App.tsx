import { useEffect, useRef, useState } from 'react';
import { AgoraSession } from './agora-session.js';
import {
  AgentChatTranscript,
  type TranscriptMessage,
} from './components/transcript-view.js';
import { AgentChatInput } from './components/agents-ui/agent-chat-input.js';
import { TranscriptPanel } from './components/transcript-panel.js';
import { Icon } from './components/icons.js';
export default function App() {
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef<AgoraSession | undefined>(undefined);
  const mounted = useRef(true);
  const [phase, setPhase] = useState<
    'idle' | 'starting' | 'active' | 'stopping' | 'ended'
  >('idle');
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [microphone, setMicrophone] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void session.current?.dispose();
    };
  }, []);
  const stop = async () => {
    const current = session.current;
    if (!current) return;
    session.current = undefined;
    setPhase('stopping');
    setMicrophone(false);
    await current.dispose();
    if (mounted.current) setPhase('ended');
  };
  const start = async () => {
    if (!stage.current || session.current) return;
    setError('');
    setMessages([]);
    setPhase('starting');
    const current = new AgoraSession(
      (items) => {
        if (mounted.current && session.current === current) setMessages(items);
      },
      (message) => {
        if (mounted.current) setError(message);
      },
      () => {
        if (session.current === current) void stop();
      },
    );
    session.current = current;
    try {
      await current.start(stage.current);
      if (!mounted.current || session.current !== current) return;
      setPhase('active');
      try {
        await current.setMicrophone(true);
        if (session.current === current && mounted.current) setMicrophone(true);
      } catch {
        if (session.current === current)
          setError(
            'Microphone unavailable. Allow access or continue by typing.',
          );
      }
    } catch (failure) {
      if (!mounted.current || session.current !== current) return;
      setError(
        failure instanceof Error ? failure.message : 'Could not connect.',
      );
      await stop();
    }
  };
  return (
    <main className="avatar-app" data-phase={phase}>
      <div ref={stage} className="avatar-canvas" aria-label="Avatar stage" />
      <header className="session-header">
        <a className="brand-pill glass" href="/">
          <Icon name="chat" />
          Spatius starter
        </a>
      </header>
      {phase !== 'active' ? (
        <section className="welcome-state">
          <h1>
            {phase === 'starting'
              ? 'Starting conversation'
              : phase === 'stopping'
                ? 'Ending conversation'
                : phase === 'ended'
                  ? 'Conversation ended'
                  : 'Voice assistant'}
          </h1>
          <p className="welcome-description">
            Talk to your avatar or send a message. Follow along in the
            transcript.
          </p>
          <button
            className="primary-button"
            disabled={phase === 'stopping'}
            onClick={() => void (phase === 'starting' ? stop() : start())}
          >
            {phase === 'starting'
              ? 'Cancel'
              : phase === 'ended'
                ? 'Start a new conversation'
                : 'Start conversation'}
          </button>
        </section>
      ) : (
        <div className="conversation-tools">
          <div className="call-dock">
            <button
              className="primary-button"
              aria-pressed={microphone}
              disabled={pending}
              onClick={() => {
                const current = session.current;
                setPending(true);
                void current
                  ?.setMicrophone(!microphone)
                  .then(() => {
                    if (session.current === current) setMicrophone(!microphone);
                  })
                  .catch(() =>
                    setError(
                      'Could not change the microphone. Try again or keep typing.',
                    ),
                  )
                  .finally(() => setPending(false));
              }}
            >
              {microphone ? 'Mute microphone' : 'Enable microphone'}
            </button>
            <button className="primary-button" onClick={() => void stop()}>
              End call
            </button>
          </div>
        </div>
      )}
      {error && (
        <p
          className="control-error"
          role="alert"
          style={{
            position: 'absolute',
            bottom: '12rem',
            left: '1.5rem',
            maxWidth: '28rem',
          }}
        >
          {error}
        </p>
      )}
      <footer className="stage-footer">
        Powered by Spatius <span>×</span> Agora
      </footer>
      <TranscriptPanel>
        <AgentChatTranscript messages={messages} agentName="Your agent" />
        <div className="panel-composer">
          <AgentChatInput
            disabled={phase !== 'active'}
            onSend={(text) => {
              if (!session.current)
                return Promise.reject(new Error('Not connected'));
              return session.current.send(text);
            }}
          />
        </div>
      </TranscriptPanel>
    </main>
  );
}

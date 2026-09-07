import { scenario, scenarioData } from './scenario.js';
import { useEffect, useRef, useState } from 'react';
import { SessionAttempt, type PreparedSession } from './session-attempt.js';
import {
  Conversation,
  type ConversationEnd,
} from './components/conversation.js';
import { AgentChatTranscript } from './components/agents-ui/agent-chat-transcript.js';
import { TranscriptPanel } from './components/transcript-panel.js';
import { Icon } from './components/icons.js';

type Phase = 'idle' | 'starting' | 'active' | 'stopping' | 'ended' | 'error';
export default function App() {
  const stage = useRef<HTMLDivElement>(null);
  const current = useRef<SessionAttempt | undefined>(undefined);
  const mounted = useRef(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [character, setCharacter] = useState(
    () => sessionStorage.getItem('spatius-character') ?? 'friend',
  );
  const [detail, setDetail] = useState('');
  const [prepared, setPrepared] = useState<PreparedSession>();
  const [completed, setCompleted] = useState<ConversationEnd>();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const attempt = current.current;
      current.current = undefined;
      void attempt?.dispose();
    };
  }, []);

  const end = async (result?: ConversationEnd) => {
    const attempt = current.current;
    if (!attempt) return;
    // Invalidate callbacks synchronously, before the first cleanup await.
    current.current = undefined;
    setPrepared(undefined);
    setCompleted(result);
    setPhase('stopping');
    await attempt.dispose();
    if (!mounted.current || current.current) return;
    setDetail(result?.error || '');
    setPhase(result?.error ? 'error' : result ? 'ended' : 'idle');
  };
  const start = async () => {
    if (!stage.current || current.current || phase === 'stopping') return;
    const attempt = new SessionAttempt();
    current.current = attempt;
    setPrepared(undefined);
    setCompleted(undefined);
    setPhase('starting');
    setDetail('Opening your conversation');
    // Playback unlock is attempted on the explicit gesture; a button remains if blocked.
    void attempt.room.startAudio().catch(() => undefined);
    try {
      const result = await attempt.prepare(stage.current, (status) => {
        if (current.current === attempt && mounted.current) setDetail(status);
      });
      if (current.current !== attempt || !mounted.current) {
        await attempt.dispose();
        return;
      }
      setPrepared(result);
      setPhase('active');
    } catch {
      if (current.current !== attempt || !mounted.current) return;
      await end({
        messages: [],
        agentName: 'Your agent',
        error:
          attempt.stage === 'bootstrap'
            ? 'Could not create a session. Check your connection and Worker credentials, or rerun the project setup.'
            : 'Could not load your avatar. Check the configured Spatius app and avatar, and use a browser with WebGPU and encoded-transform support.',
      });
    }
  };

  return (
    <main className="avatar-app" data-phase={phase}>
      <div ref={stage} className="avatar-canvas" aria-label="Avatar stage" />
      {prepared ? (
        <Conversation
          prepared={prepared}
          onEnd={(result) => void end(result)}
        />
      ) : (
        <>
          <header className="session-header">
            <a className="brand-pill glass" href="/" aria-label="Spatius home">
              <Icon name="chat" />
              Spatius starter
            </a>
          </header>
          <section className="welcome-state" aria-labelledby="welcome-heading">
            <span
              className={
                phase === 'starting' || phase === 'stopping'
                  ? 'loading-spinner'
                  : 'welcome-icon'
              }
              aria-hidden="true"
            >
              {phase !== 'starting' && phase !== 'stopping' && (
                <Icon name="mic" />
              )}
            </span>
            <h1 id="welcome-heading">
              {phase === 'ended'
                ? 'Conversation ended'
                : phase === 'error'
                  ? 'Unable to connect'
                  : phase === 'starting'
                    ? 'Starting conversation'
                    : phase === 'stopping'
                      ? 'Ending conversation'
                      : 'Voice assistant'}
            </h1>
            <p
              className="welcome-description"
              role={phase === 'error' ? 'alert' : 'status'}
            >
              {detail ||
                (phase === 'ended'
                  ? 'Your conversation has ended. The full transcript is still here.'
                  : 'Talk to your avatar or send a message. Follow along in the transcript.')}
            </p>
            {scenario === 'companion' && (
              <label>
                Character{' '}
                <select
                  value={character}
                  disabled={phase === 'starting' || phase === 'stopping'}
                  onChange={(event) => {
                    setCharacter(event.target.value);
                    sessionStorage.setItem(
                      'spatius-character',
                      event.target.value,
                    );
                  }}
                >
                  {scenarioData.characters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {phase === 'starting' ? (
              <button
                key="cancel-start"
                className="primary-button"
                type="button"
                onClick={() => void end()}
              >
                Cancel
              </button>
            ) : (
              <button
                key="start"
                className="primary-button"
                type="button"
                disabled={phase === 'stopping'}
                onClick={() => void start()}
              >
                {phase === 'ended'
                  ? 'Start a new conversation'
                  : phase === 'error'
                    ? 'Try again'
                    : phase === 'stopping'
                      ? 'Ending…'
                      : 'Start conversation'}
              </button>
            )}
            <p className="privacy-note">
              {phase === 'ended'
                ? 'Microphone off · Session closed'
                : 'Your microphone turns on only after you start.'}
            </p>
          </section>
          <footer className="stage-footer">
            Powered by Spatius <span>×</span> LiveKit
          </footer>
          <TranscriptPanel>
            <AgentChatTranscript
              messages={completed?.messages}
              agentName={completed?.agentName}
            />
            <p className="transcript-notice">
              {completed
                ? 'This transcript stays available until you start again or leave this page.'
                : 'Voice and typed messages will appear here when your conversation starts.'}
            </p>
          </TranscriptPanel>
        </>
      )}
    </main>
  );
}

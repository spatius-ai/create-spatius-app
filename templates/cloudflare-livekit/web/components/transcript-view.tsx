// Copyright LiveKit. Apache-2.0. Adapted from Agents UI; see agents-ui/PROVENANCE.md.
import { useLayoutEffect, useRef, useState } from 'react';
export interface TranscriptMessage {
  id: string;
  timestamp: number;
  message: string;
  isUser: boolean;
  source?: 'user' | 'agent' | 'avatar';
  senderIdentity?: string;
}
export function AgentChatTranscript({
  messages = [],
  agentState,
  agentName = 'Agent',
}: {
  messages?: readonly TranscriptMessage[];
  agentState?: string;
  agentName?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const scrollToLatest = () => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
    atBottom.current = true;
    setShowLatest(false);
  };
  useLayoutEffect(() => {
    if (atBottom.current) scrollToLatest();
    else setShowLatest(true);
  }, [messages, agentState]);
  return (
    <div className="transcript-container">
      <div
        ref={viewport}
        className="transcript-scroll"
        role="log"
        aria-label="Conversation transcript"
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
          if (atBottom.current) setShowLatest(false);
        }}
      >
        {messages.length === 0 && (
          <p className="transcript-empty">
            Your conversation will appear here as you speak or type.
          </p>
        )}
        {messages.map(({ id, timestamp, isUser, message, source }) => (
          <article
            key={id}
            className="transcript-message"
            data-speaker={isUser ? 'user' : 'agent'}
            data-source={source}
          >
            <div className="message-meta">
              <span>{isUser ? 'You' : agentName}</span>
              <time dateTime={new Date(timestamp).toISOString()}>
                {new Date(timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
            <p>{message}</p>
          </article>
        ))}
        {agentState === 'thinking' && (
          <p className="thinking-indicator" role="status">
            Thinking<span aria-hidden="true">…</span>
          </p>
        )}
      </div>
      {showLatest && (
        <button
          className="jump-to-latest"
          type="button"
          onClick={scrollToLatest}
        >
          Latest messages ↓
        </button>
      )}
    </div>
  );
}

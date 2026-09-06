// Copyright LiveKit. Apache-2.0. Adapted from Agents UI; see ./PROVENANCE.md.
import { useLayoutEffect, useRef, useState } from 'react';
import type { AgentState, ReceivedMessage } from '@livekit/components-react';
export type TranscriptMessage = Pick<
  ReceivedMessage,
  'id' | 'timestamp' | 'message'
> & {
  isUser: boolean;
  source?: 'user' | 'agent' | 'avatar';
  senderIdentity?: string;
};
export type ConversationParticipants = {
  agentIdentity?: string;
  avatarIdentity?: string;
};
export function snapshotMessages(
  messages: ReceivedMessage[],
  participants: ConversationParticipants = {},
  previous: readonly TranscriptMessage[] = [],
): TranscriptMessage[] {
  const previousById = new Map(
    previous.map((message) => [message.id, message]),
  );
  return messages.flatMap(({ id, timestamp, message, from, type }) => {
    if (!message.trim()) return [];
    const isUser = type === 'userTranscript' || Boolean(from?.isLocal);
    // The SDK can lose `from` after a participant leaves. Retain attribution by
    // stream ID so the final update and interrupted text still replace in place.
    const prior = previousById.get(id);
    const senderIdentity = from?.identity ?? prior?.senderIdentity;
    const isAvatar =
      Boolean(
        senderIdentity && senderIdentity === participants.avatarIdentity,
      ) ||
      Boolean(
        participants.agentIdentity &&
        from?.attributes?.['lk.publish_on_behalf'] ===
          participants.agentIdentity,
      );
    if (
      !isUser &&
      senderIdentity &&
      participants.agentIdentity &&
      senderIdentity !== participants.agentIdentity &&
      !isAvatar
    )
      return [];
    // The avatar relays speech; service chat isn't a voice-agent response.
    if (isAvatar && type !== 'agentTranscript') return [];
    return [
      {
        id,
        timestamp,
        message,
        isUser,
        senderIdentity,
        source: isUser
          ? 'user'
          : isAvatar
            ? 'avatar'
            : (prior?.source ?? 'agent'),
      },
    ];
  });
}
export function AgentChatTranscript({
  messages = [],
  agentState,
  agentName = 'Agent',
}: {
  messages?: readonly TranscriptMessage[];
  agentState?: AgentState;
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

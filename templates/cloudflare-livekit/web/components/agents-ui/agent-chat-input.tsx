// Copyright LiveKit. Apache-2.0. Extracted/adapted from AgentControlBar; see ./PROVENANCE.md.
import { useRef, useState } from 'react';
import { Icon } from '../icons.js';
export function AgentChatInput({
  disabled = false,
  onSend,
}: {
  disabled?: boolean;
  onSend: (message: string) => Promise<unknown>;
}) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const isDisabled = disabled || isSending || !message.trim();
  const handleSend = async () => {
    if (isDisabled || sending.current) return;
    sending.current = true;
    setIsSending(true);
    setError('');
    try {
      await onSend(message.trim());
      setMessage('');
    } catch {
      setError('Message not sent. Your text is still here — try again.');
    } finally {
      sending.current = false;
      setIsSending(false);
    }
  };
  return (
    <div className="chat-input-group">
      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <label className="sr-only" htmlFor="conversation-message">
          Message your agent
        </label>
        <textarea
          id="conversation-message"
          rows={1}
          value={message}
          disabled={disabled || isSending}
          placeholder="Type a message…"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          className="send-button"
          type="submit"
          aria-label={isSending ? 'Sending message' : 'Send message'}
          disabled={isDisabled}
        >
          <Icon name="send" />
        </button>
      </form>
      {error && (
        <p role="alert" className="control-error">
          {error}
        </p>
      )}
    </div>
  );
}

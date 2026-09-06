// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReceivedMessage } from '@livekit/components-react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AgentChatInput } from '../../web/components/agents-ui/agent-chat-input.js';
import {
  AgentChatTranscript,
  snapshotMessages,
} from '../../web/components/agents-ui/agent-chat-transcript.js';
import { AgentTrackToggle } from '../../web/components/agents-ui/agent-track-toggle.js';
afterEach(cleanup);
describe('upstream UI adaptations', () => {
  it('keeps failed draft, submits once, and clears only on success', async () => {
    const onSend = vi
      .fn()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue(undefined);
    render(<AgentChatInput onSend={onSend} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  hello  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('alert');
    expect((input as HTMLTextAreaElement).value).toBe('  hello  ');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
    expect(onSend).toHaveBeenNthCalledWith(1, 'hello');
    expect(onSend).toHaveBeenCalledTimes(2);
  });
  it('does not send during IME composition, Shift+Enter, or whitespace input', () => {
    const send = vi.fn();
    render(<AgentChatInput onSend={send} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(
      screen
        .getByRole('button', { name: 'Send message' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
  it('updates streaming content by stable ID and renders untrusted text as text', () => {
    const messages = [
      { id: 'same', timestamp: 0, message: 'A partial', isUser: false },
    ];
    const { rerender } = render(<AgentChatTranscript messages={messages} />);
    rerender(
      <AgentChatTranscript
        messages={[
          { ...messages[0], message: '<img src=x onerror=alert(1)> complete' },
        ]}
      />,
    );
    expect(screen.queryByText('A partial')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(document.querySelector('img')).toBeNull();
  });
  it('preserves repeated utterances with different stream IDs', () => {
    const messages = snapshotMessages([
      { id: 'one', type: 'agentTranscript', timestamp: 0, message: 'Yes' },
      { id: 'two', type: 'agentTranscript', timestamp: 1, message: 'Yes' },
    ]);
    expect(messages).toHaveLength(2);
  });
  it('distinguishes the user, voice agent, and avatar relay without displaying service chat', () => {
    const from = (identity: string, attributes = {}, isLocal = false) =>
      ({ identity, attributes, isLocal }) as NonNullable<
        ReceivedMessage['from']
      >;
    const messages: ReceivedMessage[] = [
      {
        id: 'user',
        type: 'userTranscript',
        timestamp: 0,
        message: 'Hello',
        from: from('me', {}, true),
      },
      {
        id: 'agent',
        type: 'agentTranscript',
        timestamp: 1,
        message: 'Hi',
        from: from('python'),
      },
      {
        id: 'avatar',
        type: 'agentTranscript',
        timestamp: 2,
        message: 'Spoken reply',
        from: from('renderer', { 'lk.publish_on_behalf': 'python' }),
      },
      {
        id: 'service',
        type: 'chatMessage',
        timestamp: 3,
        message: 'Service event',
        from: from('renderer'),
      },
      {
        id: 'other',
        type: 'agentTranscript',
        timestamp: 4,
        message: 'Unrelated',
        from: from('other'),
      },
    ];
    const participants = {
      agentIdentity: 'python',
      avatarIdentity: 'renderer',
    };
    const snapshot = snapshotMessages(messages, participants);
    expect(snapshot.map(({ source }) => source)).toEqual([
      'user',
      'agent',
      'avatar',
    ]);
    expect(snapshot.map(({ senderIdentity }) => senderIdentity)).toEqual([
      'me',
      'python',
      'renderer',
    ]);
    const final = snapshotMessages(
      [
        {
          id: 'avatar',
          type: 'agentTranscript',
          timestamp: 2,
          message: 'Spoken',
        },
      ],
      participants,
      snapshot,
    );
    expect(final).toEqual([{ ...snapshot[2], message: 'Spoken' }]);
  });
  it('exposes a controlled accessible microphone toggle', () => {
    const change = vi.fn();
    render(<AgentTrackToggle pressed={false} onPressedChange={change} />);
    const button = screen.getByRole('button', { name: 'Enable microphone' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(change).toHaveBeenCalledWith(true);
  });
});

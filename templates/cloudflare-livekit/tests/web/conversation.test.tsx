// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Room } from 'livekit-client';
import type { PreparedSession } from '../../web/session-attempt.js';
import { Conversation } from '../../web/components/conversation.js';

// Keep the real device hook: its observable resets state when onError changes.
vi.mock('@livekit/components-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@livekit/components-react')>()),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  RoomAudioRenderer: () => null,
  useSessionContext: () => ({ end: vi.fn() }),
  useSession: () => ({
    start: () => new Promise(() => {}),
    isConnected: false,
  }),
  useAgent: () => ({ internal: {}, state: 'connecting' }),
  useSessionMessages: () => ({ messages: [], isSending: false }),
  useLocalParticipant: () => ({ isMicrophoneEnabled: false }),
  useMultibandTrackVolume: () => [],
  useStartAudio: () => ({ mergedProps: {} }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the real LiveKit device subscription stable across renders', async () => {
  vi.stubGlobal('isSecureContext', true);
  const enumerateDevices = vi
    .fn()
    .mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Test microphone' },
    ]);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  const errors = vi.spyOn(console, 'error').mockImplementation((message) => {
    // Fail promptly instead of letting an effect loop hang the test runner.
    if (String(message).includes('Maximum update depth'))
      throw new Error('Device selector entered a render loop');
  });
  const room = new Room();
  const prepared = {
    attempt: { room, abort: new AbortController() },
    tokenSource: {},
  } as PreparedSession;
  const view = () => (
    <StrictMode>
      <Conversation prepared={prepared} onEnd={() => {}} />
    </StrictMode>
  );
  const { rerender } = render(view());
  await waitFor(() =>
    expect(
      screen.getByRole('option', { name: 'Test microphone' }),
    ).toBeTruthy(),
  );
  const initialCalls = enumerateDevices.mock.calls.length;
  rerender(view());
  await waitFor(() =>
    expect(
      screen.getByRole('option', { name: 'Test microphone' }),
    ).toBeTruthy(),
  );
  expect(enumerateDevices).toHaveBeenCalledTimes(initialCalls);
  expect(errors).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../web/session-attempt.js', () => ({
  SessionAttempt: class {
    constructor() {
      return mocks.create() as object;
    }
  },
}));
vi.mock('../../web/components/conversation.js', () => ({
  Conversation: () => <p>Live test conversation</p>,
}));
import App from '../../web/App.js';
function createAttempt() {
  let resolve!: (value: object) => void;
  let reject!: (error: Error) => void;
  let progress!: (status: string) => void;
  const abort = new AbortController();
  return {
    stage: 'bootstrap',
    abort,
    room: { startAudio: vi.fn().mockResolvedValue(undefined) },
    prepare: vi.fn(
      (_container: HTMLElement, report: (status: string) => void) => {
        progress = report;
        return new Promise<object>((done, fail) => {
          resolve = done;
          reject = fail;
        });
      },
    ),
    dispose: vi.fn(() => {
      abort.abort();
      return Promise.resolve();
    }),
    resolve: (value: object) => resolve(value),
    reject: (error: Error) => reject(error),
    progress: (status: string) => progress(status),
  };
}
beforeEach(() => {
  mocks.create.mockImplementation(createAttempt);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
describe('explicit app lifecycle', () => {
  it('StrictMode mount does not create a room, fetch credentials or request microphone', () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('synchronously rejects double Start and ignores a stale progress/completion after cancel', async () => {
    const attempt = createAttempt();
    mocks.create.mockReturnValueOnce(attempt);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const start = screen.getByRole('button', { name: 'Start conversation' });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(mocks.create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      await Promise.resolve();
      attempt.progress('STALE UPDATE');
      attempt.resolve({ attempt, tokenSource: {} });
      await Promise.resolve();
    });
    expect(screen.queryByText('STALE UPDATE')).toBeNull();
    expect(screen.queryByText('Live test conversation')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Start conversation' }),
    ).toBeTruthy();
    expect(attempt.abort.signal.aborted).toBe(true);
  });
  it('disposes on unmount and never renders a late bootstrap result', async () => {
    const attempt = createAttempt();
    mocks.create.mockReturnValueOnce(attempt);
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    unmount();
    await act(async () => {
      attempt.resolve({ attempt, tokenSource: {} });
      await Promise.resolve();
    });
    expect(attempt.dispose).toHaveBeenCalled();
    expect(attempt.abort.signal.aborted).toBe(true);
  });
  it('uses actionable bootstrap guidance without exposing raw error payloads', async () => {
    const attempt = createAttempt();
    mocks.create.mockReturnValueOnce(attempt);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    await act(async () => {
      attempt.reject(new Error('secret-token=not-for-ui'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Worker credentials',
    );
    expect(document.body.textContent).not.toContain('secret-token');
  });
});

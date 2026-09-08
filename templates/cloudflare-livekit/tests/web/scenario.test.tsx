// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
const state = vi.hoisted(() => ({ scenario: 'tutoring' }));
vi.mock('../../web/scenario.js', async () => {
  const actual = await vi.importActual<typeof import('../../web/scenario.js')>(
    '../../web/scenario.js',
  );
  return {
    ...actual,
    get scenario() {
      return state.scenario;
    },
  };
});
import { ScenarioPanel } from '../../web/components/scenario-panel.js';
const controls = () => ({
  speak: vi.fn().mockResolvedValue(undefined),
  interrupt: vi.fn().mockResolvedValue(undefined),
  setMode: vi.fn().mockResolvedValue(undefined),
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('gives a tutoring hint and reads the selected feedback', async () => {
  state.scenario = 'tutoring';
  const actions = controls();
  render(<ScenarioPanel ready controls={actions} />);
  fireEvent.click(screen.getByRole('button', { name: '10' }));
  expect(screen.getByRole('status').textContent).toContain('making ten');
  expect(actions.speak).toHaveBeenCalledWith(
    expect.stringContaining('making ten'),
  );
  fireEvent.click(screen.getByRole('button', { name: '12' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('right'),
  );
});
it('filters FAQ topics without dispatching speech', () => {
  state.scenario = 'customer-service';
  const actions = controls();
  render(<ScenarioPanel ready controls={actions} />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'no-matching-topic' },
  });
  expect(screen.queryByRole('button', { name: 'Read answer' })).toBeNull();
  expect(actions.speak).not.toHaveBeenCalled();
});
it('interrupts the simulated audience before entering free conversation', async () => {
  state.scenario = 'live-streaming';
  vi.useFakeTimers();
  const actions = controls();
  render(<ScenarioPanel ready controls={actions} />);
  await act(() => vi.advanceTimersByTimeAsync(12000));
  expect(actions.speak).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Talk with host' }));
    await Promise.resolve();
  });
  expect(actions.interrupt).toHaveBeenCalledTimes(1);
  expect(actions.setMode).toHaveBeenCalledWith('free-talk');
  await act(() => vi.advanceTimersByTimeAsync(24000));
  expect(actions.speak).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'Return to audience' }),
  ).toBeTruthy();
});

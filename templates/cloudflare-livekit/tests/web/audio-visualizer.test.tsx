// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { LocalAudioTrack } from 'livekit-client';
import { useMultibandTrackVolume } from '@livekit/components-react';
import { AgentAudioVisualizerBar } from '../../web/components/agents-ui/agent-audio-visualizer-bar.js';

vi.mock('@livekit/components-react', () => ({
  useMultibandTrackVolume: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('uses the local track and reacts to real bands, silence, mute and replacement tracks', () => {
  const track = {} as LocalAudioTrack;
  const volume = vi.mocked(useMultibandTrackVolume);
  volume.mockReturnValue([0, 0.25, 0.5, 0.75, 1]);
  const { container, rerender } = render(
    <AgentAudioVisualizerBar audioTrack={track} enabled />,
  );
  const heights = () =>
    [...container.querySelectorAll<HTMLElement>('.audio-bars span')].map(
      (bar) => bar.style.height,
    );
  expect(
    screen.getByRole('group', { name: 'Your microphone activity' }),
  ).toBeTruthy();
  expect(volume).toHaveBeenLastCalledWith(track, {
    bands: 5,
    loPass: 100,
    hiPass: 200,
  });
  expect(heights()).toEqual(['4px', '6px', '12px', '18px', '24px']);
  volume.mockReturnValue([0, 0, 0, 0, 0]);
  rerender(<AgentAudioVisualizerBar audioTrack={track} enabled />);
  expect(heights()).toEqual(Array(5).fill('4px'));
  volume.mockReturnValue([1, 1, 1, 1, 1]);
  rerender(<AgentAudioVisualizerBar audioTrack={track} enabled={false} />);
  expect(volume).toHaveBeenLastCalledWith(undefined, expect.anything());
  expect(heights()).toEqual(Array(5).fill('4px'));
  expect(screen.getByText('Microphone off')).toBeTruthy();
  const replacement = {} as LocalAudioTrack;
  rerender(<AgentAudioVisualizerBar audioTrack={replacement} enabled />);
  expect(volume).toHaveBeenLastCalledWith(replacement, expect.anything());
});

it('renders five silent bars without a published microphone', () => {
  vi.mocked(useMultibandTrackVolume).mockReturnValue([]);
  const { container } = render(<AgentAudioVisualizerBar enabled={false} />);
  expect(container.querySelectorAll('.audio-bars span')).toHaveLength(5);
});

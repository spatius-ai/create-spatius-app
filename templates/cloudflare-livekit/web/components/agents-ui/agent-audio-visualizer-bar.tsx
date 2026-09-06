// Copyright LiveKit. Apache-2.0. Adapted from Agents UI; see ./PROVENANCE.md.
import {
  useMultibandTrackVolume,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import type { LocalAudioTrack } from 'livekit-client';

/** Microphone-only Agents UI bar visualizer. No simulated agent-state animation. */
export function AgentAudioVisualizerBar({
  audioTrack,
  enabled,
}: {
  audioTrack?: LocalAudioTrack | TrackReferenceOrPlaceholder;
  enabled: boolean;
}) {
  const bands = useMultibandTrackVolume(enabled ? audioTrack : undefined, {
    bands: 5,
    loPass: 100,
    hiPass: 200,
  });
  return (
    <div
      className="user-audio"
      role="group"
      aria-label="Your microphone activity"
    >
      <span>You</span>
      <div className="audio-bars" aria-hidden="true" data-enabled={enabled}>
        {Array.from({ length: 5 }, (_, index) => (
          <span
            key={index}
            style={{
              height: `${Math.max(4, (enabled ? Math.min(1, Math.max(0, bands[index] ?? 0)) : 0) * 24)}px`,
            }}
          />
        ))}
      </div>
      <span className="audio-label">
        {enabled ? 'Microphone on' : 'Microphone off'}
      </span>
    </div>
  );
}

// Copyright LiveKit. Apache-2.0. Adapted from Agents UI; see ./PROVENANCE.md.
import { useStartAudio } from '@livekit/components-react';
import type { Room } from 'livekit-client';
import { Icon } from '../icons.js';
export function StartAudioButton({ room }: { room: Room }) {
  const { mergedProps } = useStartAudio({ room, props: {} });
  return (
    <button type="button" {...mergedProps} className="audio-unlock">
      <Icon name="audio" />
      Enable sound
    </button>
  );
}

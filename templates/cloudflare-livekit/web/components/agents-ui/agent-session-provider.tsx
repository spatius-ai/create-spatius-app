// Copyright LiveKit. Apache-2.0. Upstream source and adaptations: ./PROVENANCE.md.
import {
  SessionProvider,
  type UseSessionReturn,
  RoomAudioRenderer,
  type SessionProviderProps,
  type RoomAudioRendererProps,
} from '@livekit/components-react';
import type { Room } from 'livekit-client';
export type AgentSessionProviderProps = SessionProviderProps &
  RoomAudioRendererProps & {
    room?: Room;
    volume?: number;
    muted?: boolean;
    session: UseSessionReturn;
    children: React.ReactNode;
  };
export function AgentSessionProvider({
  session,
  children,
  ...roomAudioRendererProps
}: AgentSessionProviderProps) {
  return (
    <SessionProvider session={session}>
      {children}
      <RoomAudioRenderer {...roomAudioRendererProps} />
    </SessionProvider>
  );
}

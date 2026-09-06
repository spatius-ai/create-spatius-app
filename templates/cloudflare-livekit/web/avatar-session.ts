import {
  AvatarManager,
  AvatarSDK,
  AvatarView,
  DrivingServiceMode,
} from '@spatius/avatarkit';
import { AvatarPlayer, LiveKitProvider } from '@spatius/avatarkit-rtc';
import type { Room } from 'livekit-client';
import type { VoiceSession } from './api.js';

export interface AvatarSessionController {
  dispose: () => Promise<void>;
}
let initialization: Promise<void> | undefined;

export async function attachAvatarSession(
  container: HTMLElement,
  session: VoiceSession,
  room: Room,
  signal: AbortSignal,
  reportStatus: (status: string) => void,
): Promise<AvatarSessionController> {
  let view: AvatarView | undefined;
  let player: AvatarPlayer | undefined;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      try {
        await player?.detach();
      } finally {
        view?.dispose();
        container.style.backgroundImage = '';
      }
    })();
    return disposal;
  };
  try {
    signal.throwIfAborted();
    reportStatus('Preparing your avatar');
    if (!AvatarSDK.configuration) {
      initialization ??= AvatarSDK.initialize(session.spatius_app_id, {
        drivingServiceMode: DrivingServiceMode.rtc,
      })
        .then(() => undefined)
        .catch((error: unknown) => {
          initialization = undefined;
          throw error;
        });
      await initialization;
    }
    signal.throwIfAborted();
    const avatar = await AvatarManager.shared.load(session.spatius_avatar_id);
    signal.throwIfAborted();
    container.style.backgroundImage = session.spatius_avatar_background_url
      ? `url(${JSON.stringify(session.spatius_avatar_background_url)})`
      : '';
    view = new AvatarView(avatar, container);
    player = new AvatarPlayer(new LiveKitProvider(), view);
    // Borrow before connect; the host owns the room, microphone and audio playback.
    await player.attach(room);
    signal.throwIfAborted();
    return { dispose };
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
}

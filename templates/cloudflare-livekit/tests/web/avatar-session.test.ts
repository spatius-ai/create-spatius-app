import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from 'livekit-client';
const sdk = vi.hoisted(() => ({
  initialize: vi.fn(),
  load: vi.fn(),
  view: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('@spatius/avatarkit', () => ({
  AvatarSDK: { configuration: {}, initialize: sdk.initialize },
  AvatarManager: { shared: { load: sdk.load } },
  DrivingServiceMode: { rtc: 'rtc' },
  AvatarView: class {
    constructor() {
      sdk.view();
    }
    dispose = sdk.dispose;
  },
}));
vi.mock('@spatius/avatarkit-rtc', () => ({
  LiveKitProvider: class {},
  AvatarPlayer: class {
    attach = sdk.attach;
    detach = sdk.detach;
  },
}));
import { attachAvatarSession } from '../../web/avatar-session.js';
const credentials = {
  server_url: 'wss://example.invalid',
  participant_token: 'token',
  room_name: 'room',
  spatius_app_id: 'app',
  spatius_avatar_id: 'configured-avatar',
};
beforeEach(() => {
  sdk.load.mockResolvedValue({});
  sdk.attach.mockResolvedValue(undefined);
  sdk.detach.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());
describe('AvatarKit external room adapter', () => {
  it('applies the public background behind the view and removes it on disposal', async () => {
    const container = { style: { backgroundImage: '' } } as HTMLElement;
    const controller = await attachAvatarSession(
      container,
      {
        ...credentials,
        spatius_avatar_background_url: 'https://cdn.example.com/room.jpg',
      },
      {} as Room,
      new AbortController().signal,
      vi.fn(),
    );
    expect(container.style.backgroundImage).toBe(
      'url("https://cdn.example.com/room.jpg")',
    );
    await controller.dispose();
    expect(container.style.backgroundImage).toBe('');
  });

  it('attaches to the host room and only detaches/disposes its own resources', async () => {
    const room = { connect: vi.fn(), disconnect: vi.fn() } as unknown as Room;
    const controller = await attachAvatarSession(
      { style: { backgroundImage: '' } } as HTMLElement,
      credentials,
      room,
      new AbortController().signal,
      vi.fn(),
    );
    expect(sdk.load).toHaveBeenCalledWith('configured-avatar');
    expect(sdk.attach).toHaveBeenCalledExactlyOnceWith(room);
    expect(room.connect).not.toHaveBeenCalled();
    await controller.dispose();
    await controller.dispose();
    expect(sdk.detach).toHaveBeenCalledOnce();
    expect(sdk.dispose).toHaveBeenCalledOnce();
    expect(room.disconnect).not.toHaveBeenCalled();
  });
  it('cleans up an attach failure and still disposes the view when detach fails', async () => {
    sdk.attach.mockRejectedValueOnce(new Error('attach failed'));
    sdk.detach.mockRejectedValueOnce(new Error('already detached'));
    await expect(
      attachAvatarSession(
        { style: { backgroundImage: '' } } as HTMLElement,
        credentials,
        {} as Room,
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow('attach failed');
    expect(sdk.dispose).toHaveBeenCalledOnce();
  });
  it('does not construct a late renderer after an aborted asset load', async () => {
    let finish!: (value: object) => void;
    sdk.load.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const controller = new AbortController();
    const pending = attachAvatarSession(
      { style: { backgroundImage: '' } } as HTMLElement,
      credentials,
      {} as Room,
      controller.signal,
      vi.fn(),
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    finish({});
    await rejected;
    expect(sdk.view).not.toHaveBeenCalled();
    expect(sdk.attach).not.toHaveBeenCalled();
  });
});

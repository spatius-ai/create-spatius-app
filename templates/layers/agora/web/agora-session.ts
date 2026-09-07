import type { IAgoraRTCClient } from 'agora-rtc-sdk-ng';
import type { AvatarPlayer } from '@spatius/avatarkit-rtc';
import type { AvatarView } from '@spatius/avatarkit';
import type { AgoraVoiceAI } from 'agora-agent-client-toolkit';
import type { RTMClient } from 'agora-rtm-sdk';
import type { TranscriptMessage } from './components/transcript-view.js';
interface Credentials {
  capability: string;
  appId: string;
  channel: string;
  uid: number;
  agentUid: number;
  token: string;
  spatiusAppId: string;
  avatarId: string;
  region: string;
}
let initialization: Promise<void> | undefined;
export class AgoraSession {
  private credentials?: Credentials;
  private player?: AvatarPlayer;
  private view?: AvatarView;
  private rtm?: RTMClient;
  private toolkit?: AgoraVoiceAI;
  private microphone?: MediaStream;
  private cancelled = false;
  private starting?: Promise<void>;
  private microphoneBusy = false;
  private readonly pagehide = () => {
    if (this.credentials)
      navigator.sendBeacon(
        '/api/session/stop',
        new Blob(
          [JSON.stringify({ capability: this.credentials.capability })],
          { type: 'application/json' },
        ),
      );
  };
  constructor(
    private readonly onMessages: (messages: TranscriptMessage[]) => void,
    private readonly onError: (message: string) => void,
    private readonly onDisconnected: () => void = () => undefined,
  ) {}
  start(container: HTMLElement): Promise<void> {
    this.starting ??= this.prepare(container).catch(async (error: unknown) => {
      await this.cleanup();
      throw error;
    });
    return this.starting;
  }
  private check() {
    if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
  }
  private async prepare(container: HTMLElement) {
    // Keep the bootstrap response observable after cancellation so a started remote agent can be stopped.
    const response = await fetch('/api/session', {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(
        'Could not start the agent. Check the Agora pipeline and Spatius configuration.',
      );
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid session response');
    const value = raw as Credentials;
    if (
      ![
        'capability',
        'appId',
        'channel',
        'token',
        'spatiusAppId',
        'avatarId',
        'region',
      ].every(
        (key) => typeof (raw as Record<string, unknown>)[key] === 'string',
      ) ||
      !Number.isInteger(value.uid) ||
      !Number.isInteger(value.agentUid)
    )
      throw new Error('Invalid session response');
    this.credentials = value;
    window.addEventListener('pagehide', this.pagehide);
    this.check();
    const [
      { AvatarSDK, AvatarManager, AvatarView, DrivingServiceMode },
      { AvatarPlayer, AgoraProvider },
      { default: AgoraRTM },
      toolkit,
    ] = await Promise.all([
      import('@spatius/avatarkit'),
      import('@spatius/avatarkit-rtc'),
      import('agora-rtm-sdk'),
      import('agora-agent-client-toolkit'),
    ]);
    this.check();
    initialization ??= AvatarSDK.initialize(value.spatiusAppId, {
      drivingServiceMode: DrivingServiceMode.rtc,
      region: value.region,
    }).catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
    await initialization;
    this.check();
    const avatar =
      AvatarManager.shared.retrieve(value.avatarId) ??
      (await AvatarManager.shared.load(value.avatarId));
    this.check();
    if (!avatar) throw new Error('Avatar could not be loaded');
    this.view = new AvatarView(avatar, container);
    this.player = new AvatarPlayer(new AgoraProvider(), this.view, {
      logLevel: 'error',
    });
    await this.player.connect({
      appId: value.appId,
      channel: value.channel,
      token: value.token,
      uid: value.uid,
    });
    this.check();
    const client = this.player.getNativeClient() as IAgoraRTCClient;
    client.on('connection-state-change', (state) => {
      if (state === 'DISCONNECTED' && !this.cancelled) this.onDisconnected();
    });
    this.rtm = new AgoraRTM.RTM(value.appId, String(value.uid));
    await this.rtm.login({ token: value.token });
    this.check();
    this.toolkit = await toolkit.AgoraVoiceAI.init({
      rtcEngine: client,
      rtmEngine: this.rtm,
      enableLog: false,
    });
    this.toolkit.on(toolkit.AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => {
      if (this.cancelled) return;
      this.onMessages(
        items.map((item) => ({
          id: `${item.uid}:${item.turn_id}:${item.stream_id}`,
          timestamp: item._time || Date.now(),
          message: item.text,
          isUser: item.uid === String(value.uid),
        })),
      );
    });
    this.toolkit.on(toolkit.AgoraVoiceAIEvents.MESSAGE_ERROR, () =>
      this.onError(
        'The agent could not process the message. Please try again.',
      ),
    );
    this.toolkit.subscribeMessage(value.channel);
    await this.rtm.subscribe(value.channel);
    this.check();
    await new Promise<void>((resolve, reject) => {
      const ready = () =>
        client.remoteUsers.some(
          (user) => String(user.uid) === String(value.agentUid),
        );
      if (ready()) {
        resolve();
        return;
      }
      const timeout = window.setTimeout(() => {
        client.off('user-joined', joined);
        reject(new Error('The agent did not join in time.'));
      }, 30000);
      function joined() {
        if (ready()) {
          window.clearTimeout(timeout);
          client.off('user-joined', joined);
          resolve();
        }
      }
      client.on('user-joined', joined);
    });
    this.check();
  }
  async setMicrophone(enabled: boolean) {
    this.check();
    if (!this.player || this.microphoneBusy) return;
    this.microphoneBusy = true;
    try {
      if (!enabled) {
        await this.player.unpublishAudio();
        this.microphone?.getTracks().forEach((track) => track.stop());
        this.microphone = undefined;
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (this.cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        this.check();
      }
      this.microphone = stream;
      await this.player.publishAudio(stream.getAudioTracks()[0]);
      if (this.cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        await this.player.unpublishAudio();
      }
    } finally {
      this.microphoneBusy = false;
    }
  }
  async send(text: string) {
    this.check();
    if (!this.toolkit || !this.credentials) throw new Error('Not connected');
    const { ChatMessagePriority, ChatMessageType } =
      await import('agora-agent-client-toolkit');
    await this.toolkit.sendText(String(this.credentials.agentUid), {
      messageType: ChatMessageType.TEXT,
      text,
      priority: ChatMessagePriority.INTERRUPTED,
      responseInterruptable: true,
    });
  }
  async dispose() {
    this.cancelled = true;
    await this.starting?.catch(() => undefined);
    await this.cleanup();
  }
  private async cleanup() {
    window.removeEventListener('pagehide', this.pagehide);
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.microphone = undefined;
    const toolkit = this.toolkit,
      view = this.view,
      player = this.player,
      rtm = this.rtm,
      credentials = this.credentials;
    this.toolkit = undefined;
    this.view = undefined;
    this.player = undefined;
    this.rtm = undefined;
    this.credentials = undefined;
    const results = await Promise.allSettled([
      Promise.resolve().then(() => toolkit?.destroy()),
      Promise.resolve().then(() => player?.disconnect()),
      Promise.resolve().then(() => rtm?.logout()),
      credentials
        ? fetch('/api/session/stop', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ capability: credentials.capability }),
            keepalive: true,
            signal: AbortSignal.timeout(15000),
          }).then((response) => {
            if (!response.ok) throw new Error('Remote cleanup failed');
          })
        : undefined,
    ]);
    try {
      view?.dispose();
    } catch {
      this.onError(
        'The avatar renderer could not be fully released. Reload before reconnecting.',
      );
    }
    if (results.some((result) => result.status === 'rejected'))
      this.onError(
        'Session ended locally. Remote cleanup could not be confirmed; the agent idle timeout is the fallback.',
      );
  }
}

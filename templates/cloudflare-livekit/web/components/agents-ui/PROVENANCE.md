# LiveKit Agents UI source

These components are derived from [LiveKit components-js](https://github.com/livekit/components-js/tree/c68a22bc6e56fa38221166044163956d20b59c55/packages/shadcn/components/agents-ui), revision `c68a22bc6e56fa38221166044163956d20b59c55`, under the Apache 2.0 license included in `LICENSE`.

The source paths below are relative to `packages/shadcn/components/agents-ui/` at that revision. The source was inspected directly; no generated component registry installation was run.

| Local file                  | Upstream source                         | Adaptations                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| agent-session-provider.tsx  | agent-session-provider.tsx              | Formatting and compact types; retains SessionProvider and the single RoomAudioRenderer.                                                                                                                                  |
| agent-track-toggle.tsx      | agent-track-toggle.tsx                  | Keeps controlled/uncontrolled pressed state; microphone-only native button replaces Radix/CVA/icons, adds pending/accessible labels.                                                                                     |
| agent-disconnect-button.tsx | agent-disconnect-button.tsx             | Native button; preventDefault lets the host include avatar cleanup and preserve the transcript; catches fallback end rejection.                                                                                          |
| agent-chat-input.tsx        | AgentChatInput in agent-control-bar.tsx | Native form/button, injected send function from the single useSessionMessages stream; adds IME guard, error display, synchronous duplicate-send guard.                                                                   |
| agent-chat-transcript.tsx   | agent-chat-transcript.tsx               | Retains message ID, timestamp, origin and agent-thinking presentation; plain-text/native scroll view replaces Streamdown and the message-scroller dependency tree. Adds a serializable snapshot for post-call retention. |
| start-audio-button.tsx      | start-audio-button.tsx                  | Native button replaces the shadcn Button, retaining useStartAudio merged props.                                                                                                                                          |

The surrounding conversation composition uses LiveKit's `useSession`, `useAgent`, `useSessionMessages`, `useLocalParticipant` and `useMediaDeviceSelect`. It does not instantiate a second chat hook or audio renderer. Device enumeration uses `requestPermissions: false`; the user starts microphone acquisition explicitly by starting the conversation or retrying the microphone.

Transcript snapshots retain user, voice-agent, and avatar-relay attribution using
LiveKit's participant identities and `lk.publish_on_behalf` relationship. Unrelated
remote messages and avatar-service chat are excluded; sender attribution survives
participant departure and the final interrupted stream update.

`agent-audio-visualizer-bar.tsx` is a microphone-only adaptation of the same
upstream revision's `agent-audio-visualizer-bar.tsx`. It retains LiveKit's
`useMultibandTrackVolume` sampling and band-to-height rendering, with five compact
bars. The generic sizes, CVA styling, child-cloning API, and simulated agent-state
sequencer are omitted. Muting disconnects the analyser input and resets the bars;
this component does not acquire a microphone or render audio.

The shell uses neutral, shadcn-style tokens and simple bordered controls so it is
easy to restyle for another application. The Inter font is bundled separately with
its OFL license and provenance in `web/assets/`.

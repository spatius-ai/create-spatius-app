// Copyright LiveKit. Apache-2.0. Adapted from Agents UI; see ./PROVENANCE.md.
import type { ReceivedMessage } from '@livekit/components-react';
import type { TranscriptMessage } from '../transcript-view.js';
export {
  AgentChatTranscript,
  type TranscriptMessage,
} from '../transcript-view.js';
export type ConversationParticipants = {
  agentIdentity?: string;
  avatarIdentity?: string;
};
export function snapshotMessages(
  messages: ReceivedMessage[],
  participants: ConversationParticipants = {},
  previous: readonly TranscriptMessage[] = [],
): TranscriptMessage[] {
  const previousById = new Map(
    previous.map((message) => [message.id, message]),
  );
  return messages.flatMap(({ id, timestamp, message, from, type }) => {
    if (!message.trim()) return [];
    const isUser = type === 'userTranscript' || Boolean(from?.isLocal);
    // The SDK can lose `from` after a participant leaves. Retain attribution by
    // stream ID so the final update and interrupted text still replace in place.
    const prior = previousById.get(id);
    const senderIdentity = from?.identity ?? prior?.senderIdentity;
    const isAvatar =
      Boolean(
        senderIdentity && senderIdentity === participants.avatarIdentity,
      ) ||
      Boolean(
        participants.agentIdentity &&
        from?.attributes?.['lk.publish_on_behalf'] ===
          participants.agentIdentity,
      );
    if (
      !isUser &&
      senderIdentity &&
      participants.agentIdentity &&
      senderIdentity !== participants.agentIdentity &&
      !isAvatar
    )
      return [];
    // The avatar relays speech; service chat isn't a voice-agent response.
    if (isAvatar && type !== 'agentTranscript') return [];
    return [
      {
        id,
        timestamp,
        message,
        isUser,
        senderIdentity,
        source: isUser
          ? 'user'
          : isAvatar
            ? 'avatar'
            : (prior?.source ?? 'agent'),
      },
    ];
  });
}

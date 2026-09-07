export const AGENT_DISPATCH_METADATA_VERSION = 1 as const;

export interface AgentDispatchMetadataV1 {
  avatar: {
    id: string;
  };
  voice?: { id: string };
  version: typeof AGENT_DISPATCH_METADATA_VERSION;
}

export function serializeAgentDispatchMetadata(
  avatarId: string,
  voiceId?: string,
  context?: Record<string, unknown>,
): string {
  const metadata = {
    avatar: { id: avatarId },
    ...(voiceId?.trim() ? { voice: { id: voiceId.trim() } } : {}),
    ...(context ? { context } : {}),
    version: AGENT_DISPATCH_METADATA_VERSION,
  } satisfies AgentDispatchMetadataV1;

  return JSON.stringify(metadata);
}

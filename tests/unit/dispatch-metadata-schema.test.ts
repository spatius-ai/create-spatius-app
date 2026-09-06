import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import dispatchMetadataSchema from '../../templates/cloudflare-livekit/contracts/agent-dispatch-metadata.schema.json' with { type: 'json' };
import { serializeAgentDispatchMetadata } from '../../templates/cloudflare-livekit/worker/dispatch-metadata.js';

const validateDispatchMetadata = new Ajv2020({ strict: true }).compile(
  dispatchMetadataSchema,
);

describe('agent dispatch metadata contract', () => {
  it('accepts metadata serialized by the Worker', () => {
    const metadata: unknown = JSON.parse(
      serializeAgentDispatchMetadata('avatar-123'),
    );

    expect(
      validateDispatchMetadata(metadata),
      JSON.stringify(validateDispatchMetadata.errors),
    ).toBe(true);
  });

  it('allows backward-compatible optional fields', () => {
    const metadata = {
      avatar: { id: 'avatar-123', style: 'friendly' },
      session: { locale: 'en-US' },
      version: 1,
    };

    expect(
      validateDispatchMetadata(metadata),
      JSON.stringify(validateDispatchMetadata.errors),
    ).toBe(true);
  });

  it('rejects missing avatar selection and unsupported versions', () => {
    expect(validateDispatchMetadata({ avatar: {}, version: 1 })).toBe(false);
    expect(
      validateDispatchMetadata({ avatar: { id: '   ' }, version: 1 }),
    ).toBe(false);
    expect(
      validateDispatchMetadata({ avatar: { id: 'avatar-123' }, version: 2 }),
    ).toBe(false);
  });
});

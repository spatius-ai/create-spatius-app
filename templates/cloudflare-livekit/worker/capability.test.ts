import { describe, expect, it, vi } from 'vitest';
import { signCapability, verifyCapability } from './capability.js';
describe('session capabilities', () => {
  it('binds purpose and expiry and rejects tampering', async () => {
    const secret = 'test-only-signing-key';
    const token = await signCapability(
      secret,
      { purpose: 'session', room: 'one' },
      10,
    );
    expect(await verifyCapability(secret, token, 'session')).toMatchObject({
      room: 'one',
    });
    await expect(verifyCapability(secret, token, 'memory')).rejects.toThrow();
    await expect(
      verifyCapability(secret, token + 'x', 'session'),
    ).rejects.toThrow();
    await expect(
      verifyCapability('different-key', token, 'session'),
    ).rejects.toThrow();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 20000);
      await expect(verifyCapability(secret, token, 'session')).rejects.toThrow(
        'Expired',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

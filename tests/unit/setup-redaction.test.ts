import { describe, expect, it } from 'vitest';

import { maskSecret, SecretRedactor } from '../../src/setup/redaction.js';

describe('secret redaction', () => {
  it('masks labels without revealing complete values', () => {
    expect(maskSecret('abcd')).toBe('••••');
    expect(maskSecret('secret-value-1234')).toBe('••••1234');
  });

  it('redacts registered values, bearer tokens, assignments, and query values', () => {
    const redactor = new SecretRedactor();
    redactor.add('distinctive-livekit-secret', undefined, 'tiny');
    const output = redactor.redact(
      'distinctive-livekit-secret Authorization: Bearer abc.def ' +
        'api_key=another-secret&auth_code=one-time-code ' +
        'refresh_token: refresh-value',
    );

    for (const secret of [
      'distinctive-livekit-secret',
      'abc.def',
      'another-secret',
      'one-time-code',
      'refresh-value',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[REDACTED]');
  });

  it('sanitizes errors while retaining a safe cause', () => {
    const redactor = new SecretRedactor();
    redactor.add('super-secret-value');

    const result = redactor.error(
      new Error('request contained super-secret-value'),
      'fallback',
    );
    expect(result.message).toBe('request contained [REDACTED]');
    expect(result.cause).toBeInstanceOf(Error);
    expect(redactor.error({}, 'safe fallback').message).toBe('safe fallback');
  });
});

import { describe, expect, it } from 'vitest';

import {
  CliError,
  EXIT_CODES,
  formatError,
  normalizeError,
  PromptCancelledError,
} from '../../src/errors.js';

describe('formatError', () => {
  it('uses an error message', () => {
    expect(formatError(new Error('Something failed.'))).toBe(
      'Something failed.',
    );
  });

  it('does not expose arbitrary values', () => {
    expect(formatError({ secret: 'value' })).toBe(
      'An unexpected error occurred while creating the project.',
    );
  });

  it('preserves structured CLI errors', () => {
    const error = new CliError('TARGET_NOT_EMPTY', 'Not empty.', {
      exitCode: EXIT_CODES.targetConflict,
      path: '/project',
      recovery: 'Choose an empty directory.',
    });

    expect(normalizeError(error)).toBe(error);
    expect(error).toMatchObject({
      code: 'TARGET_NOT_EMPTY',
      exitCode: 3,
      path: '/project',
      recovery: 'Choose an empty directory.',
    });
  });

  it('uses the cancellation exit status', () => {
    expect(new PromptCancelledError()).toMatchObject({
      code: 'CANCELLED',
      exitCode: 130,
    });
  });
});

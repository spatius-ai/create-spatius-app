import { describe, expect, it, vi } from 'vitest';

import { PromptCancelledError } from '../../src/errors.js';
import {
  DEFAULT_PROJECT_DIRECTORY,
  resolveProjectDirectoryInput,
} from '../../src/input.js';

describe('resolveProjectDirectoryInput', () => {
  it('uses an explicit project directory without prompting', async () => {
    const prompt = vi.fn();

    await expect(
      resolveProjectDirectoryInput({
        argument: '  example-app  ',
        interactive: false,
        prompt,
      }),
    ).resolves.toBe('example-app');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('uses the default in non-interactive mode', async () => {
    const prompt = vi.fn();

    await expect(
      resolveProjectDirectoryInput({ interactive: false, prompt }),
    ).resolves.toBe(DEFAULT_PROJECT_DIRECTORY);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('returns the interactive answer', async () => {
    await expect(
      resolveProjectDirectoryInput({
        interactive: true,
        prompt: vi.fn().mockResolvedValue('interactive-app'),
      }),
    ).resolves.toBe('interactive-app');
  });

  it('turns prompt cancellation into a typed error', async () => {
    await expect(
      resolveProjectDirectoryInput({
        interactive: true,
        prompt: vi.fn().mockResolvedValue(Symbol('cancelled')),
      }),
    ).rejects.toBeInstanceOf(PromptCancelledError);
  });

  it('rejects an empty value', async () => {
    await expect(
      resolveProjectDirectoryInput({
        argument: '  ',
        interactive: false,
        prompt: vi.fn(),
      }),
    ).rejects.toThrow('cannot be empty');
  });
});

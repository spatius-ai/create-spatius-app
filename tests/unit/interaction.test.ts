import { describe, expect, it } from 'vitest';

import { resolveInteractionMode } from '../../src/interaction.js';

const defaultOptions = {
  isAgent: false,
  isTerminal: true,
  isYesMode: false,
  json: false,
};

describe('resolveInteractionMode', () => {
  it('uses explicit modes before environment detection', () => {
    expect(
      resolveInteractionMode({
        ...defaultOptions,
        ci: '1',
        explicit: true,
        isAgent: true,
        isTerminal: false,
      }),
    ).toBe(true);
    expect(resolveInteractionMode({ ...defaultOptions, explicit: false })).toBe(
      false,
    );
  });

  it('disables prompts for yes, JSON, CI, agent, and non-TTY execution', () => {
    expect(resolveInteractionMode({ ...defaultOptions, isYesMode: true })).toBe(
      false,
    );
    expect(resolveInteractionMode({ ...defaultOptions, json: true })).toBe(
      false,
    );
    expect(resolveInteractionMode({ ...defaultOptions, ci: 'true' })).toBe(
      false,
    );
    expect(resolveInteractionMode({ ...defaultOptions, isAgent: true })).toBe(
      false,
    );
    expect(
      resolveInteractionMode({ ...defaultOptions, isTerminal: false }),
    ).toBe(false);
  });

  it('allows prompts for a human terminal and ignores false CI values', () => {
    expect(resolveInteractionMode(defaultOptions)).toBe(true);
    expect(resolveInteractionMode({ ...defaultOptions, ci: 'false' })).toBe(
      true,
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  resolveCredentialSetupDecision,
  resolveInteractionMode,
} from '../../src/interaction.js';

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

const setupDefaults = {
  command: 'create' as const,
  dryRun: false,
  explicitlyInteractive: false,
  interactive: true,
  isAgent: false,
  isSecureTerminal: true,
  json: false,
  yes: false,
};

describe('resolveCredentialSetupDecision', () => {
  it('offers setup to a human terminal and honors explicit choices', () => {
    expect(resolveCredentialSetupDecision(setupDefaults)).toBe('ask');
    expect(
      resolveCredentialSetupDecision({ ...setupDefaults, requested: true }),
    ).toBe('run');
    expect(
      resolveCredentialSetupDecision({ ...setupDefaults, requested: false }),
    ).toBe('skip');
  });

  it('skips implicit setup for agents and non-interactive modes', () => {
    expect(
      resolveCredentialSetupDecision({ ...setupDefaults, isAgent: true }),
    ).toBe('skip');
    expect(
      resolveCredentialSetupDecision({
        ...setupDefaults,
        explicitlyInteractive: true,
        isAgent: true,
      }),
    ).toBe('skip');
    expect(
      resolveCredentialSetupDecision({
        ...setupDefaults,
        interactive: false,
        isSecureTerminal: false,
      }),
    ).toBe('skip');
    for (const override of [
      { ci: '1' },
      { dryRun: true },
      { json: true },
      { yes: true },
    ]) {
      expect(
        resolveCredentialSetupDecision({ ...setupDefaults, ...override }),
      ).toBe('skip');
    }
  });

  it('allows an agent only after an explicit interactive opt-in', () => {
    expect(
      resolveCredentialSetupDecision({
        ...setupDefaults,
        explicitlyInteractive: true,
        isAgent: true,
        requested: true,
      }),
    ).toBe('run');
    expect(() =>
      resolveCredentialSetupDecision({
        ...setupDefaults,
        isAgent: true,
        requested: true,
      }),
    ).toThrow(/--interactive/u);
  });

  it('requires a secure terminal for explicit and standalone setup', () => {
    expect(() =>
      resolveCredentialSetupDecision({
        ...setupDefaults,
        isSecureTerminal: false,
        requested: true,
      }),
    ).toThrow(/secure interactive terminal/u);
    expect(
      resolveCredentialSetupDecision({ ...setupDefaults, command: 'setup' }),
    ).toBe('run');
  });

  it('rejects explicit setup in CI and machine modes', () => {
    for (const override of [
      { ci: 'true' },
      { dryRun: true },
      { json: true },
      { yes: true },
    ]) {
      expect(() =>
        resolveCredentialSetupDecision({
          ...setupDefaults,
          ...override,
          requested: true,
        }),
      ).toThrow(/cannot run/u);
    }
  });
});

import { basename } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveTemplateDirectory } from '../../src/template.js';

describe('resolveTemplateDirectory', () => {
  it('resolves the template relative to the current module', () => {
    expect(basename(resolveTemplateDirectory())).toBe('template');
  });
});

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const skillDirectory = resolve('skills/create-spatius-app');

describe('portable bootstrap skill', () => {
  it('has valid discoverable Agent Skills metadata without tool-specific permissions', async () => {
    const source = await readFile(resolve(skillDirectory, 'SKILL.md'), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source);
    expect(frontmatter).not.toBeNull();
    const document = parseDocument(frontmatter![1]!);
    expect(document.errors).toEqual([]);
    const metadata = document.toJS() as Record<string, unknown>;
    expect(metadata.name).toBe(basename(skillDirectory));
    expect(metadata.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    expect(String(metadata.name).length).toBeLessThanOrEqual(64);
    expect(typeof metadata.description).toBe('string');
    expect(String(metadata.description).trim().length).toBeGreaterThan(0);
    expect(String(metadata.description).length).toBeLessThanOrEqual(1024);
    expect(metadata.license).toBe('MIT');
    expect(metadata).not.toHaveProperty('allowed-tools');
    expect(source).not.toMatch(/\[TODO:|\bTBD\b|__SPATIUS_/u);
  });
});

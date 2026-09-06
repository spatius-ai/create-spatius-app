import { readFile } from 'node:fs/promises';

import { expect } from 'vitest';

// Read literal examples instead of maintaining a second set of CLI flags.
// Never evaluate shell syntax or resolve an npm package from these examples.
export async function documentedSkillCommands(): Promise<string[][]> {
  const source = await readFile('skills/create-spatius-app/SKILL.md', 'utf8');
  return [...source.matchAll(/^\s*npx create-spatius-app ([^\r\n]+)$/gmu)].map(
    (match) => {
      expect(match[1]).toMatch(/^[a-zA-Z0-9 .-]+$/u);
      return match[1]!.trim().split(/\s+/u);
    },
  );
}

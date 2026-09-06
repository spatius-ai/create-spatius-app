import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatNextSteps } from '../../src/next-steps.js';

describe('human-readable next steps', () => {
  it('prints a quoted cd followed by separate commands', () => {
    const target = resolve('my app');
    expect(
      formatNextSteps(target, ['pnpm run dev'], { platform: 'linux' }),
    ).toBe(`cd '${target}'\npnpm run dev`);
  });

  it('escapes single quotes and leaves shell expansion characters literal', () => {
    const target = resolve("app's $HOME `echo` ");
    expect(
      formatNextSteps(target, ['npm run dev'], { platform: 'darwin' }),
    ).toBe(`cd '${target.replaceAll("'", "'\\''")}'\nnpm run dev`);
  });

  it('uses literal PowerShell paths on Windows', () => {
    const target = resolve("app's [draft]");
    expect(
      formatNextSteps(target, ['bun run dev'], { platform: 'win32' }),
    ).toBe(`cd -LiteralPath '${target.replaceAll("'", "''")}'\nbun run dev`);
  });

  it('omits cd when already in the project and retains required setup steps', () => {
    const cwd = resolve('app');
    expect(
      formatNextSteps(cwd, ['pnpm install', 'pnpm run dev'], { cwd }),
    ).toBe('pnpm install\npnpm run dev');
  });
});

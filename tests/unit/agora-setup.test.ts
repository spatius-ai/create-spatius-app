import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgoraSetup } from '../../src/setup/agora.js';
import { selectCatalog, validateSelection } from '../../src/catalog.js';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function project() {
  const directory = await mkdtemp(join(tmpdir(), 'spatius-agora-setup-'));
  directories.push(directory);
  await mkdir(join(directory, 'worker'));
  await Promise.all([
    writeFile(
      join(directory, 'spatius.config.json'),
      JSON.stringify({
        version: 2,
        stack: 'zeabur-agora',
      }),
    ),
    ...['package.json', '.env.local.example', 'worker/agora.ts'].map((file) =>
      writeFile(join(directory, file), ''),
    ),
  ]);
  return directory;
}
const values: Record<string, string> = {
  AGORA_APP_ID: 'a'.repeat(32),
  AGORA_APP_CERTIFICATE: 'b'.repeat(32),
  AGORA_PIPELINE_ID: 'pipeline',
  SPATIUS_APP_ID: 'spatius-app',
  SPATIUS_API_KEY: 'secret-key',
  SPATIUS_AVATAR_ID: 'avatar',
  SPATIUS_REGION: 'cn-beijing',
  AGORA_AVATAR_SAMPLE_RATE: '24000',
};
const prompts = {
  choose: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
  input: vi.fn(async (key: string) => values[key]!),
  password: vi.fn(async (key: string) => values[key]!),
};
describe('Agora-only setup', () => {
  it('uses the selected stack without prompting and rejects unknown stacks', async () => {
    const choose = vi.fn();
    expect(
      await selectCatalog({
        stack: 'zeabur-agora',
        interactive: true,
        prompts: { choose },
      }),
    ).toEqual({ stack: 'zeabur-agora' });
    expect(choose).not.toHaveBeenCalled();
    expect(() => validateSelection('invalid')).toThrow('Unsupported');
  });
  it('writes one private environment file, preserving unrelated variables', async () => {
    const directory = await project();
    await writeFile(join(directory, '.env.local'), 'EXTRA=value\n');
    expect(await runAgoraSetup({ targetDirectory: directory, prompts })).toBe(
      'configured',
    );
    const contents = await readFile(join(directory, '.env.local'), 'utf8');
    expect(contents).toContain('EXTRA=value');
    expect(contents).toContain('AGORA_PIPELINE_ID="pipeline"');
    // Windows exposes DOS attributes through stat.mode, not POSIX permissions.
    if (process.platform !== 'win32')
      expect((await stat(join(directory, '.env.local'))).mode & 0o777).toBe(
        0o600,
      );
    expect(prompts.password).toHaveBeenCalledWith('AGORA_APP_CERTIFICATE');
    expect(prompts.password).toHaveBeenCalledWith('SPATIUS_API_KEY');
  });
  it('refuses symlinked credentials', async () => {
    const directory = await project();
    await writeFile(join(directory, 'outside'), 'untouched');
    await symlink(join(directory, 'outside'), join(directory, '.env.local'));
    await expect(
      runAgoraSetup({ targetDirectory: directory, prompts }),
    ).rejects.toThrow('safely');
    expect(await readFile(join(directory, 'outside'), 'utf8')).toBe(
      'untouched',
    );
  });
});

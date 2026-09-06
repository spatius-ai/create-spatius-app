import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import {
  authenticateLiveKitCli,
  installLiveKitCli,
  planLiveKitInstall,
} from '../../src/setup/livekit-install.js';

function runner() {
  return {
    capture: vi.fn(async () => '1.0'),
    interactive: vi.fn(async () => undefined),
  };
}

describe('LiveKit installation', () => {
  it.each([
    ['darwin', false, 'brew', ['install', 'livekit-cli']],
    ['darwin', true, 'brew', ['upgrade', 'livekit-cli']],
    [
      'win32',
      false,
      'winget',
      ['install', '--id', 'LiveKit.LiveKitCLI', '--exact'],
    ],
    [
      'win32',
      true,
      'winget',
      ['upgrade', '--id', 'LiveKit.LiveKitCLI', '--exact'],
    ],
  ] as const)(
    'plans %s installation (update=%s) without executing it',
    async (platform, update, command, args) => {
      const commands = runner();
      const plan = await planLiveKitInstall(update, platform, commands);
      expect(plan).toEqual({
        command,
        args,
        displayCommand: [command, ...args].join(' '),
      });
      expect(commands.capture).toHaveBeenCalledWith(command, ['--version']);
      expect(commands.interactive).not.toHaveBeenCalled();
      await installLiveKitCli(plan!, commands);
      expect(commands.interactive).toHaveBeenCalledWith(command, args, {
        cwd: tmpdir(),
      });
    },
  );

  it('uses the official Linux installer with download failure propagation', async () => {
    const commands = runner();
    const plan = await planLiveKitInstall(false, 'linux', commands);
    expect(commands.capture).toHaveBeenCalledWith('bash', ['--version']);
    expect(commands.capture).toHaveBeenCalledWith('curl', ['--version']);
    expect(plan).toEqual({
      command: 'bash',
      args: [
        '-o',
        'pipefail',
        '-c',
        'curl -fsSL https://get.livekit.io/cli | bash',
      ],
      displayCommand: 'curl -fsSL https://get.livekit.io/cli | bash',
    });
  });

  it.each(['darwin', 'win32', 'linux', 'freebsd'] as const)(
    'offers no automatic install on %s when prerequisites are missing',
    async (platform) => {
      const commands = runner();
      commands.capture = vi.fn(async () => {
        throw new Error('missing');
      });
      await expect(
        planLiveKitInstall(false, platform, commands),
      ).resolves.toBeUndefined();
      expect(commands.interactive).not.toHaveBeenCalled();
    },
  );

  it('runs the supported browser authentication command', async () => {
    const commands = runner();
    await authenticateLiveKitCli(commands);
    expect(commands.interactive).toHaveBeenCalledWith('lk', ['cloud', 'auth'], {
      cwd: tmpdir(),
    });
  });
});

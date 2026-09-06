import { tmpdir } from 'node:os';

import {
  defaultLiveKitCommandRunner,
  type LiveKitCommandRunner,
} from './livekit.js';

export const LIVEKIT_INSTALL_GUIDE =
  'https://docs.livekit.io/reference/developer-tools/livekit-cli/';

export interface LiveKitInstallPlan {
  command: string;
  args: string[];
  displayCommand: string;
}

/** Only offer an installer when its prerequisites are already available. */
export async function planLiveKitInstall(
  update: boolean,
  platform: NodeJS.Platform = process.platform,
  runner: LiveKitCommandRunner = defaultLiveKitCommandRunner,
): Promise<LiveKitInstallPlan | undefined> {
  try {
    if (platform === 'darwin') {
      await runner.capture('brew', ['--version']);
      const args = [update ? 'upgrade' : 'install', 'livekit-cli'];
      return {
        command: 'brew',
        args,
        displayCommand: `brew ${args.join(' ')}`,
      };
    }
    if (platform === 'win32') {
      await runner.capture('winget', ['--version']);
      const args = [
        update ? 'upgrade' : 'install',
        '--id',
        'LiveKit.LiveKitCLI',
        '--exact',
      ];
      return {
        command: 'winget',
        args,
        displayCommand: `winget ${args.join(' ')}`,
      };
    }
    if (platform === 'linux') {
      await runner.capture('bash', ['--version']);
      await runner.capture('curl', ['--version']);
      // pipefail prevents a failed download from being reported as an install success.
      const script = 'curl -fsSL https://get.livekit.io/cli | bash';
      return {
        command: 'bash',
        args: ['-o', 'pipefail', '-c', script],
        displayCommand: script,
      };
    }
  } catch {
    // The user can install prerequisites themselves and retry in this wizard.
  }
  return undefined;
}

export function installLiveKitCli(
  plan: LiveKitInstallPlan,
  runner: LiveKitCommandRunner = defaultLiveKitCommandRunner,
): Promise<void> {
  return runner.interactive(plan.command, plan.args, { cwd: tmpdir() });
}

export function authenticateLiveKitCli(
  runner: LiveKitCommandRunner = defaultLiveKitCommandRunner,
): Promise<void> {
  return runner.interactive('lk', ['cloud', 'auth'], { cwd: tmpdir() });
}

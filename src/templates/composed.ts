import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StackId } from '../catalog.js';
import { agoraTemplate } from './agora.js';
import { cloudflareLivekitTemplate as base } from './cloudflare-livekit/index.js';
import { javascriptRunCommand } from '../package-managers.js';
import type { TemplateDefinition } from './types.js';

export function composeTemplate(stack: StackId): TemplateDefinition {
  if (stack === 'cloudflare-agora') return agoraTemplate;
  return {
    ...base,
    stack,
    requiresPython: true,
    layers: [{ directory: 'templates/layers/catalog' }],
    async configure(directory, configuration) {
      await base.configure(directory, configuration);
      await writeFile(
        join(directory, 'spatius.config.json'),
        JSON.stringify({ version: 2, stack }, null, 2) + '\n',
      );
      const manager = configuration.packageManagers.javascript.name;
      const run = (script: string) => javascriptRunCommand(manager, script);
      await writeFile(
        join(directory, 'DEPLOYMENT.md'),
        '# Cloudflare Workers + LiveKit Cloud\n\n' +
          `Run \`${run('wrangler -- login')}\`, set the non-secret configuration from .dev.vars.example in wrangler.jsonc, and upload LIVEKIT_API_KEY and LIVEKIT_API_SECRET using \`${run('wrangler -- secret put LIVEKIT_API_SECRET')}\` (repeat for the key). Run \`${run('deploy')}\` to deploy the frontend and API together.\n\n` +
          'From agent/, run `lk cloud auth` and `lk agent create` for the first deployment. Configure the agent secrets from agent/.env.example. Use `lk agent deploy` for updates.\n\n' +
          'Deploy the agent before opening conversations. Use separate LiveKit projects for development and production. Local setup never uploads secrets.\n',
      );
    },
  };
}

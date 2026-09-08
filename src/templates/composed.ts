import { agoraTemplate } from './agora.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stacks, type StackId } from '../catalog.js';
import { cloudflareLivekitTemplate as base } from './cloudflare-livekit/index.js';
import { javascriptRunCommand } from '../package-managers.js';
import type { TemplateDefinition } from './types.js';

export function composeTemplate(stack: StackId): TemplateDefinition {
  if (stack === 'zeabur-agora') return agoraTemplate;
  const selected = stacks[stack];
  const node = selected.web === 'railway';
  return {
    ...base,
    id: stack,
    stack,
    requiresPython: true,
    description: selected.label,
    components: [
      '- web/       React + Spatius AvatarKit',
      `- ${node ? 'server/' : 'worker/'}    ${selected.web} API`,
      '- agent/     Python LiveKit agent',
    ],
    layers: [
      { directory: 'templates/layers/catalog' },
      ...(selected.agent === 'railway'
        ? [{ directory: 'templates/layers/railway-agent' }]
        : []),
      ...(node
        ? [
            {
              directory: 'templates/layers/node',
              overrides: [
                'vite.config.ts',
                'scripts/dev-web.mjs',
                'package-lock.json',
                'pnpm-lock.yaml',
              ],
            },
          ]
        : []),
    ],
    includeFile(path, configuration) {
      if (node && ['wrangler.jsonc'].includes(path)) return false;
      return base.includeFile(path, configuration);
    },
    mapFile(path) {
      return node && path === 'dev.vars.example'
        ? '.env.local.example'
        : base.mapFile(path);
    },
    async configure(directory, configuration) {
      await base.configure(directory, configuration);
      await writeFile(
        join(directory, 'spatius.config.json'),
        JSON.stringify({ version: 2, stack }, null, 2) + '\n',
      );
      const packagePath = join(directory, 'package.json');
      const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as {
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      const manager = configuration.packageManagers.javascript.name;
      const run = (script: string) => javascriptRunCommand(manager, script);
      let deployment = `# ${selected.label}\n\n`;
      if (node) {
        for (const name of ['README.md', 'AGENTS.md', 'agent/README.md']) {
          const path = join(directory, name);
          await writeFile(
            path,
            (await readFile(path, 'utf8'))
              .replaceAll('Cloudflare Workers', 'Railway')
              .replaceAll('Cloudflare Worker', 'Node API')
              .replaceAll('.dev.vars', '.env.local') +
              '\nSee DEPLOYMENT.md for this stack’s deployment steps.\n',
          );
        }
        const workerConfigPath = join(directory, 'tsconfig.worker.json');
        await writeFile(
          workerConfigPath,
          (await readFile(workerConfigPath, 'utf8'))
            .replace(
              '"types": ["./worker-configuration.d.ts"]',
              '"types": ["./worker-configuration.d.ts", "node"]',
            )
            .replace(
              '"include": ["worker", "worker-configuration.d.ts"]',
              '"include": ["worker", "worker-configuration.d.ts", "server"]',
            ),
        );
        delete pkg.devDependencies['@cloudflare/vite-plugin'];
        delete pkg.devDependencies.wrangler;
        pkg.dependencies.tsx = '4.23.13';
        delete pkg.scripts['cf-typegen'];
        delete pkg.scripts.wrangler;
        pkg.scripts.start =
          'node --env-file-if-exists=.env.local node_modules/tsx/dist/cli.mjs server/index.ts';
        pkg.scripts.deploy = 'railway up';
        const dockerPath = join(directory, 'Dockerfile');
        const install =
          manager === 'pnpm'
            ? 'npm install --global pnpm@12.3.4 && pnpm install --frozen-lockfile'
            : manager === 'bun'
              ? 'npm install --global bun && bun install'
              : 'npm ci';
        await writeFile(
          dockerPath,
          (await readFile(dockerPath, 'utf8'))
            .replace('__SPATIUS_CONTAINER_INSTALL__', install)
            .replace('__SPATIUS_CONTAINER_BUILD__', run('build')),
        );
        deployment +=
          'Create a Railway service from this repository with the repository root as its build root and railway.json as its configuration. Add the variables from .env.local.example in Railway. Generate a public domain. The web service serves both the frontend and /api. Deploy with `railway up`; subsequent Git deployments rebuild the service.\n\n';
      } else {
        deployment += `Run \`${run('wrangler -- login')}\`, set the non-secret configuration from .dev.vars.example in wrangler.jsonc, and upload LIVEKIT_API_KEY and LIVEKIT_API_SECRET using \`${run('wrangler -- secret put LIVEKIT_API_SECRET')}\` (repeat for the key). Run \`${run('deploy')}\`.\n\n`;
      }
      if (selected.agent === 'railway') {
        deployment +=
          'Create a separate Railway agent service from this repository, with root directory /agent and configuration /agent/railway.json. Add the variables from agent/.env.example. Keep it running continuously; do not enable sleeping. No public domain is needed. Set PORT=8081 for the agent health check. Deploy this service independently of the web service.\n';
      } else
        deployment +=
          'From agent/, run `lk cloud auth` and `lk agent create` for the first deployment. Configure the agent secrets from agent/.env.example. Use `lk agent deploy` for updates.\n';
      deployment +=
        '\nDeploy the agent before opening conversations. Use separate LiveKit projects for development and production. Local setup never uploads secrets.\n';
      await writeFile(join(directory, 'DEPLOYMENT.md'), deployment);
      await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    },
  };
}

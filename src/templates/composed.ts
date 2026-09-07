import { agoraTemplate } from './agora.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stacks, type StackId, type ScenarioId } from '../catalog.js';
import { cloudflareLivekitTemplate as base } from './cloudflare-livekit/index.js';
import { javascriptRunCommand } from '../package-managers.js';
import type { TemplateDefinition } from './types.js';

export function composeTemplate(
  stack: StackId,
  scenario: ScenarioId,
): TemplateDefinition {
  if (stack === 'zeabur-agora') return agoraTemplate;
  const selected = stacks[stack];
  const node = selected.web === 'railway';
  return {
    ...base,
    id: `${stack}/${scenario}`,
    stack,
    scenario,
    requiresPython: true,
    description: `${selected.label} — ${scenario}`,
    components: [
      '- web/       React + Spatius AvatarKit',
      `- ${node ? 'server/' : 'worker/'}    ${selected.web} API`,
      '- agent/     Python LiveKit agent',
    ],
    layers: [
      { directory: 'templates/layers/catalog' },
      ...(scenario === 'companion'
        ? [
            {
              directory: 'templates/layers/companion',
              overrides: ['worker/memory.ts'],
            },
          ]
        : []),
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
      ...(node && scenario === 'companion'
        ? [
            {
              directory: 'templates/layers/companion-node',
              overrides: ['package-lock.json', 'pnpm-lock.yaml'],
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
        JSON.stringify({ version: 1, stack, template: scenario }, null, 2) +
          '\n',
      );
      const dataPath = join(directory, 'agent/src/scenario.json');
      await writeFile(
        dataPath,
        (await readFile(dataPath, 'utf8')).replace(
          '"scenario": "minimal"',
          `"scenario": "${scenario}"`,
        ),
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
              '"include": ["agent/src/scenario.json", "worker", "worker-configuration.d.ts"]',
              '"include": [\n    "agent/src/scenario.json",\n    "worker",\n    "worker-configuration.d.ts",\n    "server"\n  ]',
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
      if (scenario === 'companion') {
        deployment +=
          '\n## Companion memory\n\nSet SPATIUS_API_ORIGIN in the agent service to your public web origin (http://localhost:5173 locally). The agent reaches memory over authenticated HTTP.\n';
        if (node) {
          const serverPath = join(directory, 'server/index.ts');
          await writeFile(
            serverPath,
            (await readFile(serverPath, 'utf8'))
              .replace(
                'import { handleRequest }',
                "import { database } from './database.js';\nimport { handleRequest }",
              )
              .replace(
                'const env = process.env;',
                'const env = { ...process.env, DB: database };',
              ),
          );
          pkg.dependencies.pg = '8.16.3';
          pkg.devDependencies['@types/pg'] = '8.15.5';
          deployment +=
            'Add a Postgres service, set DATABASE_URL on the web service, then apply migrations/0001_memory.sql with psql before deploying. For local development run `docker compose up -d`, set DATABASE_URL=postgres://spatius:spatius@localhost:5432/spatius in .env.local, and apply the same migration.\n';
        } else {
          deployment +=
            'Create a D1 database with `wrangler d1 create spatius-memory`. Replace the database_id in wrangler.jsonc. Run `wrangler d1 migrations apply spatius-memory --local` for development and the same command with --remote before production deployment.\n';
          const path = join(directory, 'wrangler.jsonc');
          const contents = await readFile(path, 'utf8');
          await writeFile(
            path,
            contents.replace(
              '{',
              '{\n  "d1_databases": [\n    {\n      "binding": "DB",\n      "database_name": "spatius-memory",\n      "database_id": "REPLACE_WITH_D1_ID",\n      "migrations_dir": "migrations",\n    },\n  ],',
            ),
          );
        }
      }
      await writeFile(join(directory, 'DEPLOYMENT.md'), deployment);
      await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    },
  };
}

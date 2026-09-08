import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  javascriptRunCommand,
  javascriptInstallCommand,
} from '../package-managers.js';
import { toValidPackageName } from './cloudflare-livekit/configure.js';
import { createInstallPlan } from './cloudflare-livekit/install.js';
import { cloudflareLivekitTemplate as base } from './cloudflare-livekit/index.js';
import { runAgoraSetup } from '../setup/agora.js';
import { readProjectConfig } from '../project-config.js';
import type { TemplateDefinition } from './types.js';
const files = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'npmrc',
  'gitignore',
  'dockerignore',
  'Dockerfile',
  '.editorconfig',
  '.prettierrc.json',
  '.prettierignore',
  'README.md',
  'AGENTS.md',
  'DEPLOYMENT.md',
  'spatius.config.json',
  'index.html',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'eslint.config.mjs',
  'env.example',
  'server/index.ts',
  'worker/index.ts',
  'worker/agora.ts',
  'worker/agora.test.ts',
  'worker/capability.ts',
  'worker/capability.test.ts',
  'web/App.tsx',
  'web/main.tsx',
  'web/styles.css',
  'web/agora-session.ts',
  'web/agora-session.test.ts',
  'web/components/transcript-view.tsx',
  'web/components/transcript-panel.tsx',
  'web/components/icons.tsx',
  'web/components/agents-ui/agent-chat-input.tsx',
  'web/components/agents-ui/LICENSE',
  'web/components/agents-ui/PROVENANCE.md',
]);
export const agoraTemplate: TemplateDefinition = {
  id: 'zeabur-agora/minimal',
  stack: 'zeabur-agora',
  scenario: 'minimal',
  requiresPython: false,
  humanSteps: [
    {
      command: 'npx create-spatius-app setup . --interactive',
      reason:
        'Enter Agora and Spatius credentials in a secure interactive terminal and configure a published English Agora pipeline. Never paste secrets into chat.',
      requiresHuman: true,
      requiresTty: true,
    },
  ],
  directory: 'templates/cloudflare-livekit',
  description: 'Zeabur + Agora Conversational AI — minimal',
  components: [
    '- web/       React + Spatius AvatarKit + Agora',
    '- server/    Node HTTP API; Agora hosts the conversational agent',
  ],
  layers: [
    { directory: 'templates/layers/catalog' },
    {
      directory: 'templates/layers/node',
      overrides: ['vite.config.ts', 'package-lock.json', 'pnpm-lock.yaml'],
    },
    {
      directory: 'templates/layers/agora',
      overrides: [
        'package.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'web/App.tsx',
        'worker/index.ts',
        'tsconfig.json',
        'vitest.config.ts',
        'README.md',
        'AGENTS.md',
      ],
    },
  ],
  includeFile(path, configuration) {
    if (!base.includeFile(path, configuration)) return false;
    return (
      files.has(path) ||
      [...files].some((file) => file.startsWith(path + '/')) ||
      path === 'web/assets' ||
      path.startsWith('web/assets/')
    );
  },
  mapFile(path) {
    return path === 'env.example' ? '.env.local.example' : base.mapFile(path);
  },
  async configure(directory, configuration) {
    const manager = configuration.packageManagers.javascript;
    const run = (script: string) => javascriptRunCommand(manager.name, script);
    const path = join(directory, 'package.json');
    const pkg = JSON.parse(await readFile(path, 'utf8')) as {
      name: string;
      packageManager?: string;
      scripts: Record<string, string>;
      trustedDependencies?: string[];
    };
    pkg.name = toValidPackageName(
      configuration.projectName ?? basename(directory),
    );
    if (manager.version && manager.version !== 'unknown')
      pkg.packageManager = `${manager.name}@${manager.version}`;
    pkg.scripts.check = ['format:check', 'lint', 'typecheck', 'test', 'build']
      .map(run)
      .join(' && ');
    if (manager.name === 'bun') pkg.trustedDependencies = ['esbuild'];
    await writeFile(path, JSON.stringify(pkg, null, 2) + '\n');
    if (manager.name === 'npm') {
      const lockPath = join(directory, 'package-lock.json');
      const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        name: string;
        packages: Record<string, { name?: string }>;
      };
      lock.name = pkg.name;
      lock.packages['']!.name = pkg.name;
      await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    }
    await writeFile(
      join(directory, 'spatius.config.json'),
      JSON.stringify(
        { version: 1, stack: 'zeabur-agora', template: 'minimal' },
        null,
        2,
      ) + '\n',
    );
    const serverPath = join(directory, 'server/index.ts');
    await writeFile(
      serverPath,
      (await readFile(serverPath, 'utf8'))
        .replace(
          'import { handleRequest }',
          "import type { AgoraEnvironment } from '../worker/agora.js';\nimport { handleRequest }",
        )
        .replace(
          'const env = process.env;',
          'const env = process.env as unknown as AgoraEnvironment;',
        ),
    );
    const dockerPath = join(directory, 'Dockerfile');
    const install =
      manager.name === 'pnpm'
        ? 'npm install --global pnpm@12.3.4 && pnpm install --frozen-lockfile'
        : manager.name === 'bun'
          ? 'npm install --global bun && bun install'
          : 'npm ci';
    await writeFile(
      dockerPath,
      (await readFile(dockerPath, 'utf8'))
        .replace('__SPATIUS_CONTAINER_INSTALL__', install)
        .replace('__SPATIUS_CONTAINER_BUILD__', run('build')),
    );
    for (const name of ['README.md', 'AGENTS.md']) {
      const path = join(directory, name);
      await writeFile(
        path,
        (await readFile(path, 'utf8'))
          .replaceAll('__INSTALL__', javascriptInstallCommand(manager.name))
          .replaceAll('__DEV__', run('dev'))
          .replaceAll('__CHECK__', run('check')),
      );
    }
    await writeFile(
      join(directory, 'DEPLOYMENT.md'),
      '# Zeabur + Agora Conversational AI\n\nCreate one Zeabur service from this repository with the repository root as build root. Set ZBPACK_DOCKERFILE_PATH=Dockerfile and PORT=8787. Copy the environment variables from .env.local.example into Zeabur service variables, then generate an HTTPS domain. Use /api/health for the health check. Git redeployments rebuild the same service.\n\nThe Node service serves both frontend and API. There is no Python worker or database. Enable Agora Conversational AI and RTM, publish an English assistant pipeline, and set AGORA_PIPELINE_ID. The pipeline owns its models and voice. Match AGORA_AVATAR_SAMPLE_RATE to its TTS output.\n\nSession creation starts a hosted agent. Disconnect and initialization failures stop it through the backend. Page-close cleanup is best effort, with a 60-second idle timeout fallback. Sessions and client tokens last 30 minutes; start a fresh conversation afterward.\n\nLocal setup writes .env.local only. It never provisions Zeabur or uploads secrets.\n',
    );
  },
  createInstallPlan(directory, managers, platform) {
    return createInstallPlan(
      directory,
      { javascript: managers.javascript },
      platform,
    );
  },
  nextSteps({
    dependenciesInstalled,
    credentialsConfigured,
    javascriptPackageManager,
  }) {
    return [
      ...(dependenciesInstalled
        ? []
        : [javascriptInstallCommand(javascriptPackageManager)]),
      ...(credentialsConfigured
        ? []
        : ['npx create-spatius-app setup . --interactive']),
      javascriptRunCommand(javascriptPackageManager, 'dev'),
    ];
  },
  setup: {
    recognizes: async (directory) =>
      (await readProjectConfig(directory))?.stack === 'zeabur-agora',
    run: runAgoraSetup,
  },
  verification: [
    { javascript: 'npm', scripts: ['check'] },
    { javascript: 'pnpm', scripts: ['check'] },
  ],
};

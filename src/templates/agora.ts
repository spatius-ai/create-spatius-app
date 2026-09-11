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
  '.editorconfig',
  '.prettierrc.json',
  '.prettierignore',
  'README.md',
  'AGENTS.md',
  'DEPLOYMENT.md',
  'spatius.config.json',
  'index.html',
  'tsconfig.json',
  'tsconfig.web.json',
  'tsconfig.worker.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vitest.config.ts',
  'eslint.config.mjs',
  'dev.vars.example',
  'wrangler.jsonc',
  'scripts/check-worker.mjs',
  'worker-configuration.d.ts',
  'worker/index.ts',
  'worker/index.test.ts',
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
  id: 'cloudflare-agora',
  stack: 'cloudflare-agora',
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
  description: 'Cloudflare Workers + Agora Conversational AI',
  components: [
    '- web/       React + Spatius AvatarKit + Agora',
    '- worker/    Cloudflare API; Agora hosts the conversational agent',
  ],
  layers: [
    { directory: 'templates/layers/catalog' },
    {
      directory: 'templates/layers/agora',
      overrides: [
        'package.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'web/App.tsx',
        'worker/index.ts',
        'worker/index.test.ts',
        'worker-configuration.d.ts',
        'tsconfig.worker.json',
        '.dev.vars.example',
        'wrangler.jsonc',
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
    return base.mapFile(path);
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
      allowScripts?: Record<string, boolean>;
    };
    pkg.name = toValidPackageName(
      configuration.projectName ?? basename(directory),
    );
    if (manager.version && manager.version !== 'unknown')
      pkg.packageManager = `${manager.name}@${manager.version}`;
    else delete pkg.packageManager;
    pkg.scripts.check = [
      'format:check',
      'lint',
      'typecheck',
      'test',
      'build',
      'test:worker',
    ]
      .map(run)
      .join(' && ');
    pkg.scripts.deploy = `${run('build')} && wrangler deploy`;
    if (manager.name === 'bun')
      pkg.trustedDependencies = ['core-js', 'esbuild', 'workerd'];
    else if (
      manager.name === 'npm' &&
      Number.parseInt(manager.version ?? '', 10) >= 12
    )
      pkg.allowScripts = { 'core-js': true, esbuild: true, workerd: true };
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
      JSON.stringify({ version: 2, stack: 'cloudflare-agora' }, null, 2) + '\n',
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
      '# Cloudflare Workers + Agora Conversational AI\n\n' +
        `Run \`${run('wrangler -- login')}\`. Set your non-secret configuration from .dev.vars in the vars section of wrangler.jsonc. Upload AGORA_APP_CERTIFICATE and SPATIUS_API_KEY with \`${run('wrangler -- secret put AGORA_APP_CERTIFICATE')}\` (repeat for SPATIUS_API_KEY). Run \`${run('deploy')}\` to deploy the React frontend and API as one Cloudflare Worker.\n\n` +
        'Agora hosts the conversational agent. There is no Python worker, Node server, container, or database to deploy. Enable Agora Conversational AI and RTM, publish an English assistant pipeline, and set AGORA_PIPELINE_ID. The pipeline owns its models and voice. Match AGORA_AVATAR_SAMPLE_RATE to its TTS output.\n\n' +
        'Session creation starts a hosted agent. Disconnect and initialization failures stop it through the Worker API. Page-close cleanup is best effort, with a 60-second idle timeout fallback. Sessions and client tokens last 30 minutes; start a fresh conversation afterward.\n\n' +
        'Local setup writes .dev.vars only. It never provisions Cloudflare services or uploads secrets.\n',
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
      (await readProjectConfig(directory))?.stack === 'cloudflare-agora',
    run: runAgoraSetup,
  },
  verification: [
    { javascript: 'npm', scripts: ['check'] },
    { javascript: 'pnpm', scripts: ['check'] },
  ],
};

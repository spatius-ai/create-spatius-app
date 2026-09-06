import { CliError } from '../../errors.js';
import {
  javascriptInstallCommand,
  javascriptRunCommand,
  pythonInstallCommands,
} from '../../package-managers.js';
import { assertSpatiusProject } from '../../setup/project.js';
import type { TemplateDefinition } from '../types.js';
import { configureGeneratedTemplate } from './configure.js';
import { createInstallPlan } from './install.js';

const aliases: Readonly<Record<string, string>> = {
  'dev.vars.example': '.dev.vars.example',
  dockerignore: '.dockerignore',
  'env.example': '.env.example',
  gitignore: '.gitignore',
  npmrc: '.npmrc',
  prettierignore: '.prettierignore',
  'python-version': '.python-version',
  'Dockerfile.pip': 'Dockerfile',
  'Dockerfile.uv': 'Dockerfile',
};

export const cloudflareLivekitTemplate: TemplateDefinition = {
  id: 'cloudflare-livekit',
  directory: 'templates/cloudflare-livekit',
  description:
    'Create a React, Cloudflare Workers, and LiveKit Agents application.',
  components: [
    '- web/       React + Spatius AvatarKit',
    '- worker/    Cloudflare token and dispatch API',
    '- agent/     Python LiveKit agent',
  ],
  includeFile(path, configuration) {
    const javascript = configuration?.packageManagers.javascript.name ?? 'pnpm';
    const python = configuration?.packageManagers.python.name ?? 'uv';
    if (path === 'package-lock.json') return javascript === 'npm';
    if (['npmrc', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(path)) {
      return javascript === 'pnpm';
    }
    if (path === 'agent/uv.lock' || path === 'agent/Dockerfile.uv') {
      return python === 'uv';
    }
    if (path === 'agent/Dockerfile.pip') return python === 'pip';
    return true;
  },
  mapFile(path) {
    return path
      .split('/')
      .map((segment) => aliases[segment] ?? segment)
      .join('/');
  },
  configure: configureGeneratedTemplate,
  createInstallPlan,
  nextSteps({
    credentialsConfigured = false,
    dependenciesInstalled,
    javascriptPackageManager,
    platform,
    pythonPackageManager,
  }) {
    return [
      ...(dependenciesInstalled
        ? []
        : [
            javascriptInstallCommand(javascriptPackageManager),
            ...pythonInstallCommands(pythonPackageManager, platform),
          ]),
      ...(credentialsConfigured
        ? []
        : ['npx create-spatius-app setup . --interactive']),
      javascriptRunCommand(javascriptPackageManager, 'dev'),
    ];
  },
  deployment: {
    async run(options) {
      const { runDeployment } = await import('../../deploy/wizard.js');
      return runDeployment(options);
    },
  },
  setup: {
    async recognizes(directory) {
      // These structural markers also recognize projects generated before the
      // registry existed; no new manifest or metadata is required for setup.
      try {
        await assertSpatiusProject(directory);
        return true;
      } catch (error) {
        if (error instanceof CliError && error.code === 'INVALID_ARGUMENT') {
          return false;
        }
        throw error;
      }
    },
    async run(options) {
      const { runCredentialSetup } = await import('../../setup/wizard.js');
      return runCredentialSetup(options);
    },
  },
  verification: [
    { javascript: 'pnpm', python: 'uv', scripts: ['check', 'agent:check'] },
    { javascript: 'npm', python: 'pip', scripts: ['check', 'agent:check'] },
  ],
};

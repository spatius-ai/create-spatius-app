import { cloudflare } from '@cloudflare/vite-plugin';
import { avatarkitVitePlugin } from '@spatius/avatarkit/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const outputDirectory = resolve(import.meta.dirname, 'dist');
const avatarkit = avatarkitVitePlugin();
avatarkit.applyToEnvironment = (environment) => environment.name === 'client';

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'web') } },
  build: {
    // AvatarKit includes its renderer and WebAssembly glue in a deliberate,
    // lazy-loaded chunk. It is expected to be larger than a typical UI chunk.
    chunkSizeWarningLimit: 3200,
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'prepare-avatarkit-output',
      applyToEnvironment: (environment) => environment.name === 'client',
      buildStart() {
        mkdirSync(resolve(outputDirectory, 'assets'), { recursive: true });
      },
    },
    avatarkit,
    {
      name: 'relocate-avatarkit-output',
      applyToEnvironment: (environment) => environment.name === 'client',
      closeBundle() {
        const generatedAssets = resolve(outputDirectory, 'assets');
        const clientAssets = resolve(outputDirectory, 'client/assets');
        const generatedHeaders = resolve(outputDirectory, '_headers');

        mkdirSync(clientAssets, { recursive: true });
        cpSync(generatedAssets, clientAssets, { recursive: true });

        if (existsSync(generatedHeaders)) {
          cpSync(generatedHeaders, resolve(outputDirectory, 'client/_headers'));
        }
      },
    },
    cloudflare(),
  ],
});

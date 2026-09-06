import { defineConfig } from 'tsup';

export default defineConfig({
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);`,
  },
  clean: true,
  dts: false,
  entry: ['src/cli.ts', 'src/templates.ts'],
  format: ['esm'],
  minify: false,
  noExternal: [
    '@clack/prompts',
    '@vercel/detect-agent',
    'commander',
    'jsonc-parser',
    'smol-toml',
  ],
  outDir: 'dist',
  platform: 'node',
  sourcemap: true,
  splitting: false,
  target: 'node22',
});

import { avatarkitVitePlugin } from '@spatius/avatarkit/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'web') } },
  plugins: [react(), tailwindcss(), avatarkitVitePlugin()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 3200 },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});

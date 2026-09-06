import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// This configuration is used only by Playwright. Production has no fixture mode.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'test-only-avatar',
      enforce: 'pre',
      configureServer(server) {
        server.middlewares.use('/api/session', (request, response, next) => {
          if (request.method !== 'POST') return next();
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify({
              server_url: 'wss://example.invalid',
              participant_token: 'fixture-token',
              room_name: 'fixture-room',
              spatius_app_id: 'fixture-app',
              spatius_avatar_id: 'fixture-avatar',
            }),
          );
        });
      },
      resolveId(source, importer) {
        if (
          source === './avatar-session.js' &&
          importer?.endsWith('/web/session-attempt.ts')
        )
          return resolve(import.meta.dirname, 'fake-avatar.ts');
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, '../../web'),
      'livekit-client': resolve(import.meta.dirname, 'fake-livekit.ts'),
      '@livekit/components-react': resolve(
        import.meta.dirname,
        'fake-components.tsx',
      ),
    },
  },
});

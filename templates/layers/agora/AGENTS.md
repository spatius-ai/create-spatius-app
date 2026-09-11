# Generated Agora application

Use `__DEV__` for local development and `__CHECK__` for verification.
The Cloudflare Worker API calls hosted Conversational AI over HTTP. Agora owns
the conversational agent; this application has no Python worker or Node server.
Browser audio uses Agora RTC, and text input and transcripts use the official
Agora client toolkit. Spatius renders the avatar locally.

Keep secrets in `.dev.vars` locally and Cloudflare Worker secrets in production.
Wrangler generates the ignored `worker-configuration.d.ts` during installation
and before lint, type checking, and builds. Update `wrangler.jsonc` to change bindings.
Preserve session cleanup on disconnect and failed startup.
Use mocks for provider calls in tests. See DEPLOYMENT.md for Cloudflare setup.

# Generated Agora application

Use `__DEV__` for local development and `__CHECK__` for verification.
The Cloudflare Worker API calls hosted Conversational AI over HTTP. Agora owns
the conversational agent; this application has no Python worker or Node server.
Browser audio uses Agora RTC, and text input and transcripts use the official
Agora client toolkit. Spatius renders the avatar locally.

Keep secrets in `.dev.vars` locally and Cloudflare Worker secrets in production.
Use `wrangler types --strict-vars=false --env-interface CloudflareBindings`
after changing bindings. Preserve session cleanup on disconnect and failed startup.
Use mocks for provider calls in tests. See DEPLOYMENT.md for Cloudflare setup.

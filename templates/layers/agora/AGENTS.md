# Generated Agora application

Use `__DEV__` for local development and `__CHECK__` for verification.
The Node backend calls hosted Conversational AI over HTTP; do not add a Python
worker. Browser audio uses Agora RTC, text input and transcripts use the official
Agora client toolkit. Spatius renders the avatar locally.
Keep secrets in .env.local or deployment environment variables. Preserve session
cleanup on disconnect and failed startup. See DEPLOYMENT.md for Zeabur setup.

# Spatius voice assistant — Cloudflare + Agora

A minimal React avatar conversation with a Cloudflare Worker API and Agora
Conversational AI. The frontend and API deploy together on Cloudflare Workers;
Agora hosts the conversational agent.

Requires Node.js 22.12+, an Agora project with Conversational AI and RTM enabled,
a published English assistant pipeline, and Spatius credentials. No Python is needed.

```sh
__INSTALL__
npx create-spatius-app setup . --interactive
__DEV__
```

Local setup saves credentials in `.dev.vars`. The Vite Cloudflare plugin runs
both the frontend and Worker API locally. Open the printed URL, start a
conversation, and speak or type. Microphone permission is optional: typed
messages use Agora RTM. The transcript stays visible after disconnecting.

Configure the assistant persona, speech recognition language, model, and voice
in the published Agora pipeline. Match `AGORA_AVATAR_SAMPLE_RATE` to its TTS output.

Run `__CHECK__` to verify the application. See [DEPLOYMENT.md](DEPLOYMENT.md)
to deploy the frontend and API together to Cloudflare Workers.

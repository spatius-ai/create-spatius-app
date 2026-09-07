# Spatius voice assistant — Zeabur + Agora

A minimal React avatar conversation with an HTTP backend and Agora Conversational AI.
Requires Node.js 22.12+, an Agora project with Conversational AI and RTM enabled,
a published English assistant pipeline, and Spatius credentials. No Python is needed.

```sh
__INSTALL__
npx create-spatius-app setup . --interactive
__DEV__
```

Open the Vite URL, start a conversation, and speak or type. Microphone permission
is optional: typed messages go to the model through Agora RTM. The transcript
stays visible after disconnecting. Configure the assistant persona, speech
recognition language, model, and voice in the published Agora pipeline. Match
AGORA_AVATAR_SAMPLE_RATE to that pipeline's TTS output.

See DEPLOYMENT.md to deploy the frontend and API together to Zeabur.

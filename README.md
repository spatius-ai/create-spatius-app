# create-spatius-app

Create a voice-avatar app with Spatius and React. Choose LiveKit or Agora Conversational AI. Both templates run the frontend and API on Cloudflare Workers.

## Quick start

Requires Node.js 22.12+ and a [Spatius Studio](https://app.spatius.ai) account.
The LiveKit template also needs Python 3.11–3.14 and a LiveKit Cloud project.
The Agora template needs an Agora account and no Python tooling.

```sh
npx create-spatius-app my-app
```

Choose LiveKit or Agora Conversational AI. Follow the remaining prompts to choose package managers, install dependencies, and
configure your provider and Spatius credentials.
If LiveKit CLI is missing, setup offers to install it using Homebrew on macOS,
WinGet on Windows, or LiveKit's Linux installer. You can also enter credentials
manually or finish setup later.

Then start the app with your chosen package manager:

```sh
cd my-app
pnpm dev
# Or: npm run dev / bun run dev
```

This starts the frontend, API, and, for LiveKit, the Python agent together. Generated DEPLOYMENT.md covers deployment to Cloudflare Workers and, for LiveKit, LiveKit Cloud.
Open the URL printed in your terminal and start a conversation.

## Use with a coding agent

Install the skill, then ask your agent to bootstrap a Spatius app:

```sh
npx skills add spatius-ai/create-spatius-app --skill create-spatius-app
```

## Set up credentials later

From your generated project, run:

```sh
npx create-spatius-app setup . --interactive
```

This configures local development only; it does not deploy your app.

## Choose a provider

```sh
npx create-spatius-app my-app --stack cloudflare-livekit
# Or:
npx create-spatius-app my-app --stack cloudflare-agora
```

LiveKit is the default and deploys its Python agent to LiveKit Cloud.
Agora Conversational AI hosts the agent itself; its template needs no Python.

## More options

```sh
npx create-spatius-app --help
```

[MIT License](LICENSE)

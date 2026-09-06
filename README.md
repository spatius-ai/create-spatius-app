# create-spatius-app

Create a voice-avatar app with Spatius, React, Cloudflare Workers, and LiveKit.

> Preview: the CLI is not yet published to npm. The commands below will be
> available after the first release.

## Quick start

Requires Node.js 22 or newer.

```sh
npx create-spatius-app my-app
```

Follow the prompts to choose package managers, install dependencies, and
configure your LiveKit and Spatius credentials.
If LiveKit CLI is missing, setup offers to install it using Homebrew on macOS,
WinGet on Windows, or LiveKit's Linux installer. You can also enter credentials
manually or finish setup later.

Then start the app with your chosen package manager:

```sh
cd my-app
pnpm dev
# Or: npm run dev / bun run dev
```

This starts the frontend, Cloudflare Worker, and Python agent together.
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

## Deploy

Choose **Deploy now?** after setup, or run from your generated project:

```sh
npx create-spatius-app deploy
```

Follow the guide to publish the app to Cloudflare and the agent to LiveKit Cloud.

## More options

```sh
npx create-spatius-app --help
```

[MIT License](LICENSE)

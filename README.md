# create-spatius-app

Create a voice-avatar app with Spatius and React. Choose LiveKit with Cloudflare or Railway hosting, or Agora Conversational AI on Zeabur.

## Quick start

Requires Node.js 22.12+ and Python 3.11–3.14. You’ll also need a LiveKit Cloud
project and a [Spatius Studio](https://app.spatius.ai) account.

```sh
npx create-spatius-app my-app
```

Choose a stack, then a template: minimal, tutoring, live streaming, customer service, or companion. Follow the remaining prompts to choose package managers, install dependencies, and
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

This starts the frontend, API, and, for LiveKit stacks, the Python agent together. Generated DEPLOYMENT.md covers your selected hosting stack.
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

## Choose a stack and template

```sh
npx create-spatius-app my-tutor --stack railway-livekit --template tutoring
```

Cloudflare and Railway web hosting can each be paired with LiveKit Cloud Agents
or a LiveKit agent on Railway. Defaults remain Cloudflare + LiveKit Cloud Agents
with the minimal template. The `zeabur-agora` stack selects minimal automatically and requires no Python tooling.

## More options

```sh
npx create-spatius-app --help
```

[MIT License](LICENSE)

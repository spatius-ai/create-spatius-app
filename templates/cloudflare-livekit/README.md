# Spatius voice agent starter

A voice-avatar app built with Cloudflare Workers, LiveKit, and Spatius.

## Quick start

Requires Node.js 22.12+, Python 3.11–3.14,
{{SPATIUS_JAVASCRIPT_PACKAGE_MANAGER}}, and {{SPATIUS_PYTHON_PACKAGE_MANAGER}}.
You'll also need a LiveKit Cloud project and a [Spatius Studio](https://app.spatius.ai)
account.

Run these commands from the project root. Skip installation or credential setup
if you already completed them in the generator.

### 1. Install dependencies

```sh
__SPATIUS_JAVASCRIPT_INSTALL_COMMAND__
__SPATIUS_PYTHON_INSTALL_COMMANDS__
```

### 2. Configure credentials

```sh
npx create-spatius-app setup . --interactive
```

Follow the prompts to connect LiveKit and Spatius, select an avatar, and choose
a matching voice. This configures local development only, not deployment.

#### Manual credential setup

Alternatively, copy `.dev.vars.example` to `.dev.vars` and
`agent/.env.example` to `agent/.env.local`, then edit the copies locally:

- Use the same LiveKit Cloud project’s `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
  `LIVEKIT_API_SECRET` in both files.
- Set the same `SPATIUS_APP_ID` in both files and set `SPATIUS_API_KEY` in
  `agent/.env.local` to a key for that app.
- In `.dev.vars`, set `SPATIUS_AVATAR_ID` to your chosen avatar.
  `SPATIUS_AVATAR_BACKGROUND_URL` is optional and can stay empty. Keep the
  example `CARTESIA_VOICE_ID` to use the default voice.

Keep the example `LIVEKIT_AGENT_NAME` so the Worker dispatches the bundled
agent. Both credential files are ignored by Git; keep their values local.

### 3. Start the app

```sh
__SPATIUS_DEV_COMMAND__
```

This starts the Python agent first, then starts the frontend and Cloudflare
Worker once the agent has registered with LiveKit. If registration takes more
than 60 seconds, startup stops with an error.

Press Ctrl+C once to stop both services. If shutdown logs cover the shell prompt
and it looks as though another Ctrl+C is required, use pnpm 12.4.1 or later for
both the executable on your PATH and the `packageManager` pin in `package.json`.
An older launcher or project pin can return to the shell before the services
finish shutting down; [pnpm 12.4.1 fixes signal forwarding and waiting](https://github.com/pnpm/pnpm/releases/tag/v12.4.1).
For a Homebrew installation, run `brew update` followed by `brew upgrade pnpm`.
Set `packageManager` to `pnpm@12.4.1`, then run `pnpm install` to refresh the
package-manager lock entry. Changing only the project pin leaves an older
launcher in use; upgrading only the launcher leaves an older project pin active.

## Validate without credentials

After installing both dependency sets, you can run these checks before account
setup. Run them from the project root:

```sh
__SPATIUS_CHECK_COMMAND__
__SPATIUS_AGENT_CHECK_COMMAND__
```

These check formatting, lint, types, unit tests, development-process behavior,
and the production build. They do not require LiveKit or Spatius credentials.

Browser tests use mocked services and also run without credentials:

```sh
npx playwright install chromium
__SPATIUS_E2E_COMMAND__
```

The first command downloads Chromium if needed. On Linux, use
`npx playwright install --with-deps chromium` to also install required system
libraries. These tests verify the local UI flow; a real voice-avatar
conversation still requires account setup and starting the app.

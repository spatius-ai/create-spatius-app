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

### 3. Start the app

```sh
__SPATIUS_DEV_COMMAND__
```

This starts the Python agent first, then starts the frontend and Cloudflare
Worker once the agent has registered with LiveKit. If registration takes more
than 60 seconds, startup stops with an error.

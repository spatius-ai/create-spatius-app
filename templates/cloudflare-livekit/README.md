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

This starts the frontend, Cloudflare Worker, and Python agent together.

## Deploy the app

From the project root, run:

```sh
npx create-spatius-app deploy
```

The `deploy:app` package script runs the same guided flow. You can also choose
**Deploy now?** after creating the project. Deployment requires an interactive
terminal, a Cloudflare account with a workers.dev subdomain, and a LiveKit Cloud
project that supports agent hosting.

The guide reuses your setup credentials, offers installation of missing tools,
and connects your provider accounts. Wrangler comes from this project's
JavaScript dependencies. LiveKit CLI installation follows the platform guide:
Homebrew on macOS, WinGet on Windows, or LiveKit's Linux installer.

On the first run, choose a Cloudflare Worker name and a LiveKit region. Review
the target accounts and avatar before confirming deployment. The command builds
the web app, deploys the agent to LiveKit Cloud, waits for readiness, and
publishes the frontend and API to Cloudflare. LiveKit builds the agent remotely;
a local Docker daemon is not required.

The final URL is publicly accessible and sessions use your provider resources.
HTTP verification checks the frontend and `/api/health`; open the app and start
a conversation to verify microphone audio and avatar playback.

### Deploy updates

Run the same command again. The guide saves one target in `.spatius/deploy.json`
and the agent identity in `agent/livekit.toml`. Both stay out of Git. Keep these
files to update the same resources. If the agent source and Spatius credentials
are unchanged, the ready agent is reused. Changed local setup values are
published on the next deployment.

The existing `deploy` script remains **Cloudflare only**. It runs the build and
Wrangler directly; it does not deploy the agent or synchronize setup credentials.
Use `deploy:app` or the guided command for the complete app.

### Configuration and troubleshooting

- Deployment copies the managed non-secret values from `.dev.vars` into
  `wrangler.jsonc`, preserving other settings and comments. LiveKit API
  credentials go to Cloudflare secrets. Spatius API credentials go to LiveKit
  secrets; LiveKit Cloud supplies the hosted agent's LiveKit credentials.
  Unrelated remote secrets are preserved.
- If credentials are incomplete, finish the offered setup flow. A linked
  LiveKit project must match the URL configured during setup. Saved deployment
  targets take precedence over the CLIs' default accounts.
- If Wrangler is unavailable, accept the dependency installation offer. If an
  older dependency lacks deployment features, update Wrangler in this project.
  After installing `lk`, reopen the terminal if PATH has not refreshed.
- If your Cloudflare account has no workers.dev subdomain, enable it in the
  Workers & Pages dashboard and rerun the command.
- If the agent succeeds but Cloudflare fails, rerun the command; the ready agent
  is retained. Inspect agent status or logs from `agent/` with `lk agent status`
  and `lk agent logs`.
- If agent creation times out or is interrupted, the remote build may continue.
  Retry first: the guide reconciles the saved configuration or a unique matching
  dispatch name and region. If it cannot identify the agent, run
  `lk --project YOUR_PROJECT agent list` and restore `agent/livekit.toml` with
  the intended project's `[project].subdomain` and `[agent].id`. Do not delete
  the recovery state and blindly create another agent.
- A missing or mismatched saved resource stops deployment. Reconcile local
  configuration with provider state before retrying. A stale deployment lock
  from another computer requires checking for a running deployment before
  removing `.spatius/deploy.lock`.

The guide supports one environment and a workers.dev URL. Custom domains,
automated CI deployment, and application access controls are separate setup.

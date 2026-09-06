# Spatius voice agent starter

An opinionated full-stack starter for a conversational Spatius avatar:

- `web/` is a React frontend with LiveKit Agents UI and Spatius AvatarKit.
- `worker/` is a Cloudflare Worker that mints short-lived LiveKit tokens and
  dispatches the voice agent.
- `agent/` is a Python LiveKit Agents worker that uses LiveKit Inference and is
  deployed separately to LiveKit Cloud.

Vite builds the React app and Cloudflare serves its static assets and the
`/api/*` routes from one Worker deployment. The Python process is intentionally
an independent deployment.

## Architecture

```text
Browser (React + AvatarKit)
  ├─ POST /api/session ───────▶ Cloudflare Worker
  │                              ├─ signs a short-lived LiveKit token
  │                              └─ dispatches avatar metadata to the agent
  └─ joins the LiveKit room ───▶ LiveKit Cloud ◀── Python agent
                                    │                 ├─ LiveKit Inference
                                    │                 └─ Spatius plugin
                                    └─ synchronized audio + motion ──▶ Browser
```

Spatius renders the avatar in the browser rather than as a conventional video
track. Keep the AvatarKit client in place; a standard LiveKit video component
will show a black frame instead of the avatar.

## Prerequisites

- Node.js 22.12 or newer
- {{SPATIUS_JAVASCRIPT_PACKAGE_MANAGER}}
- Python 3.11 through 3.14
- {{SPATIUS_PYTHON_PACKAGE_MANAGER}}
- [LiveKit CLI](https://docs.livekit.io/home/cli/cli-setup/) (recommended for
  Python hot reload and automatic credential setup, but not required)
- A Cloudflare account and a LiveKit Cloud project
- A Spatius app ID, API key, and avatar ID from
  [Spatius Studio](https://app.spatius.ai)

## 1. Install dependencies

```sh
__SPATIUS_JAVASCRIPT_INSTALL_COMMAND__
__SPATIUS_PYTHON_INSTALL_COMMANDS__
```

## 2. Configure local credentials

The recommended setup is the generator's rerunnable credential wizard:

```sh
npx create-spatius-app setup . --interactive
```

The wizard uses `lk app env` when a compatible LiveKit CLI is available, with a
secure manual-entry fallback. It signs in to Spatius Studio through a temporary,
browser-approved PKCE session so you can select or explicitly create an app and
API key, then select a public or personal avatar. The temporary Spatius session
is revoked when setup finishes and is never stored on disk.

After avatar selection, choose a feminine or masculine character voice:
**Jacqueline** (feminine) or **Blake** (masculine), both standard US English
Cartesia voices. This is an explicit choice; setup does not infer gender from
an avatar. Speech uses Sonic 3.6 through LiveKit Inference with expressive mode
enabled, without a separate Cartesia API key.

Coding agents do not start browser authentication or secret prompts by default.
When an agent is operating with a PTY and a human is ready to complete the
browser and masked-input steps, opt in explicitly:

```sh
npx create-spatius-app setup . --interactive
```

During initial project creation, use `--no-setup` to skip the offer entirely, or
`--setup --interactive` to opt in explicitly from a coding-agent terminal.

This wizard configures **local development only**. It writes the ignored files
`.dev.vars` and `agent/.env.local`; it does not upload Cloudflare secrets,
configure LiveKit Cloud agent secrets, authenticate Cloudflare, or deploy
anything.

### Manual fallback

You can configure the same files without the wizard. Copy the examples:

```sh
cp .dev.vars.example .dev.vars
cp agent/.env.example agent/.env.local
```

Fill in both files. The Worker and agent must use the same LiveKit project and
Spatius app ID. Configure the avatar ID only in the Worker; it sends the
session-specific selection to the agent through LiveKit dispatch metadata. The
current Spatius SDK and LiveKit plugin resolve the service region automatically.
Do not add `SPATIUS_REGION`.

Configure `CARTESIA_VOICE_ID` only in the Worker `.dev.vars`: use
`9626c31c-bec5-4cca-baa8-f8ba9e84c8bc` for Jacqueline or
`a167e0f3-df7e-4d52-a9c3-f949145efdab` for Blake. The Worker passes this
non-secret voice ID to the agent with the avatar selection. Rerun setup and
confirm replacement to change an existing configuration interactively.

The LiveKit API key, LiveKit API secret, and Spatius API key are server-side
secrets. Never expose them through Vite variables or browser code. Existing
managed values are not replaced by the wizard without explicit confirmation;
comments and unrelated variables are preserved.

### Agent dispatch metadata

The Worker serializes session-specific agent configuration into the metadata of
the explicit LiveKit dispatch. The agent validates that JSON before starting a
session. The initial contract is:

```json
{
  "version": 1,
  "avatar": {
    "id": "your-spatius-avatar-id"
  },
  "voice": {
    "id": "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
  }
}
```

See `contracts/agent-dispatch-metadata.schema.json` for the machine-readable
contract. Version 1 permits additional properties so the business layer can add
backward-compatible session information later. Change `version` for breaking
contract changes. The `voice` field is optional: older dispatch metadata
without it continues to use Jacqueline.

## 3. Run locally

Start all three application components with one command:

```sh
__SPATIUS_DEV_COMMAND__
```

This runs Vite's React/Cloudflare Worker development server and the Python
agent together, with `[web]` and `[agent]` log prefixes. Ctrl+C stops both;
if either process exits, the other is stopped too.

The agent launcher uses `lk agent dev` when a compatible LiveKit CLI is
available. Otherwise it runs the selected uv/pip environment directly in
Python development mode. The fallback does not hot-reload Python edits;
restart the command after changing the agent. No CLI is installed and no
login or deployment is performed by the startup scripts.

Both agent runners load `agent/.env.local`, with explicitly set shell
variables taking precedence. The selected project credentials are passed to
`lk` through its environment, not command arguments or its default project.
Do not set unrelated LiveKit credentials in the shell running this project.

To work on one service separately:

```sh
__SPATIUS_WEB_DEV_COMMAND__
__SPATIUS_AGENT_DEV_COMMAND__
```

Open the local URL printed by Vite, select **Start conversation**, and allow
microphone access. The first connection can take a moment while the avatar
assets load and LiveKit dispatches the agent.

The minimal, shadcn-style interface includes microphone mute and device selection,
an audio-reactive user voice indicator from the LiveKit Agents UI adaptation,
typed messages, synchronized transcripts, connection status,
and end-call/retry controls. The transcript is always open beside the avatar
(or below it on smaller screens), with no duplicate captions over the stage. It keeps
the conversation visible after a call ends and clears it on the next start;
transcripts are not persisted or uploaded by the frontend.

The user indicator reads the existing local microphone track through LiveKit's
audio analyser. Its bars respond to voice levels, settle during silence, and reset
when muted. It never opens an additional microphone or plays audio.

LiveKit forwards transcripts in sync with speech and truncates interrupted
responses. LiveKit Inference provides sentence-level TTS alignment; the UI
does not simulate word timings or add karaoke highlighting.

### Extending the frontend

Keep application layout separate from session orchestration and the Spatius
renderer. The LiveKit room is host-owned, and Spatius attaches before it
connects. LiveKit manages microphone publication and a single audio renderer;
do not add a second audio renderer or call AvatarPlayer's microphone helpers.
The vendored Agents UI components are ordinary editable React source, not a
separate UI framework. See their accompanying provenance notice before
updating them.

## Verification

```sh
__SPATIUS_CHECK_COMMAND__
__SPATIUS_AGENT_CHECK_COMMAND__
```

Checks cover Worker routing and token creation, frontend session behavior,
and development-launcher selection without real provider credentials. The
build script also compiles the React assets and Worker with the Cloudflare
Vite plugin. Browser tests use mocked sessions and never sign in to providers.

## Deploy

Authenticate and store Worker secrets:

```sh
__SPATIUS_WRANGLER_LOGIN_COMMAND__
__SPATIUS_WRANGLER_API_KEY_COMMAND__
__SPATIUS_WRANGLER_API_SECRET_COMMAND__
```

Replace the public placeholder values in `wrangler.jsonc`, then deploy the
frontend and API together:

```sh
__SPATIUS_DEPLOY_COMMAND__
```

Deploy the Python agent to LiveKit Cloud for the first time:

```sh
lk cloud auth
cd agent
lk agent create
```

The LiveKit CLI creates `livekit.toml` during the first deployment. For later
updates, run `lk agent deploy` from `agent/`.

## Production hardening

This starter intentionally keeps session creation public for a frictionless
demo. Before production, add application authentication, authorization, abuse
controls, and rate limiting to `/api/session`. Keep token permissions and
lifetimes as narrow as your product permits.

## Stack policy

This first version supports one stack: React, Cloudflare Workers, LiveKit
Agents, LiveKit Inference, and Spatius. Keep provider-specific code behind the
existing `web/`, `worker/`, and `agent/` boundaries so future templates can add
other voice-agent providers without changing the CLI contract.

Public-avatar selection during guided setup also saves the avatar's background
image URL in `SPATIUS_AVATAR_BACKGROUND_URL` in `.dev.vars`. The Worker passes
this non-secret URL to the browser, where it sits behind the transparent avatar.
It is optional: manual avatar IDs and older configurations use a neutral
background. You can also set an HTTPS image URL manually. If the image cannot
load, the neutral background remains; it does not block the conversation.
Rerun `npx create-spatius-app setup . --interactive` and confirm replacing
the configuration to select an avatar and fetch its current background.
For deployment, copy this public URL to the corresponding Wrangler variable.

Startup shows session preparation, avatar loading, and room/agent connection
progress. Microphone publication and chat input wait until the agent is ready.
You can cancel at any point, and a stalled agent offers an explicit retry.

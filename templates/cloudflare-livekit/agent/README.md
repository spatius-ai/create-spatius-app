# LiveKit agent

This directory is a separately deployable Python LiveKit Agents worker. It
uses LiveKit Inference for speech-to-text, language generation, text-to-speech,
and turn detection. The Spatius plugin sends the generated speech through the
Spatius motion service and publishes synchronized avatar data into the same
LiveKit room as the browser.

## Voice configuration

- TTS uses `cartesia/sonic-3.6` through LiveKit Inference. Setup offers
  Jacqueline (feminine) or Blake (masculine), both standard US English voices.
  The Worker passes the selected `CARTESIA_VOICE_ID` as `voice.id` in dispatch
  metadata. Older metadata without a voice defaults to Jacqueline.
  No Cartesia API key is needed.
- `expressive=True` lets LiveKit guide the LLM's vocal delivery and remove
  delivery markup from transcripts. Keep the framework's expressive instructions
  intact; do not add a competing delivery-tag format to the assistant prompt.
- Incoming microphone audio uses Krisp `noise_cancellation.BVC()` to suppress
  background voices and noise before speech recognition. This requires LiveKit
  Cloud transport, including when running the agent locally. Do not add another
  enhanced noise-cancellation model in the browser; standard browser echo
  cancellation can stay enabled.

See [Cartesia TTS](https://docs.livekit.io/agents/models/tts/cartesia/),
[expressive mode](https://docs.livekit.io/agents/models/tts/expressive/), and
[noise cancellation](https://docs.livekit.io/transport/media/noise-cancellation/).

## Local development

From the project root:

```sh
npx create-spatius-app setup . --interactive
__SPATIUS_PYTHON_INSTALL_COMMANDS__
__SPATIUS_AGENT_DEV_COMMAND__
```

Use `__SPATIUS_DEV_COMMAND__` instead to start the frontend/Cloudflare Worker
and Python agent together. Both commands prefer `lk agent dev` when a
compatible LiveKit CLI is installed, otherwise they use the selected uv/pip
environment with `python -m livekit.agents start src/agent.py --dev`.
The direct Python fallback needs a restart after edits; `lk` provides hot
reload. Neither path logs in, installs a provider CLI, or deploys an agent.

Local settings come from `agent/.env.local`, with explicitly set shell
variables taking precedence. Complete LiveKit credentials are supplied to
`lk` via its environment so its default project cannot replace them.

The Worker session endpoint dispatches the registered name `spatius-agent`.
Keep that value synchronized with `LIVEKIT_AGENT_NAME` in the Cloudflare
configuration. The avatar ID is session configuration, not agent deployment
configuration: the Worker passes it in versioned LiveKit job metadata and the
agent supplies it directly to `spatius.AvatarSession`. See
`../contracts/agent-dispatch-metadata.schema.json` for the contract.

An absent, malformed, or unsupported metadata payload fails the job with a
configuration error instead of silently selecting an unintended avatar.

## Checks

```sh
__SPATIUS_AGENT_CHECK_COMMAND__
```

## LiveKit Cloud

Install and authenticate the LiveKit CLI, then run this from `agent/`:

```sh
lk cloud auth
lk agent create
```

The first deployment registers the named agent and creates `livekit.toml`.
Use `lk agent deploy` for later releases. Keep `livekit.toml` local until you
have reviewed the project-specific values it contains.

The Docker image runs as a non-root user and downloads model support files at
build time so startup does not need to fetch them.

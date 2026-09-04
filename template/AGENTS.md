# AGENTS.md

## Project purpose

This repository is a Spatius application with three architectural boundaries:

- `web/` is the web frontend.
- `worker/` is the Cloudflare Worker backend.
- `agent/` is the Python LiveKit agent.

The web frontend and backend will be built and deployed together as one
Cloudflare Worker. The LiveKit agent will be deployed separately to LiveKit
Cloud.

## Current state

This is a framework-neutral placeholder. Package managers, frameworks, build
commands, tests, environment variables, and deployment commands have not been
selected yet. Do not invent commands or configuration that the repository does
not contain.

## Working rules

- Preserve the three architectural boundaries unless the task explicitly
  changes them.
- Never commit secrets. Document environment-variable names without secret
  values.
- Do not authenticate, open a browser, create cloud resources, or deploy unless
  the user explicitly requests that action.
- Inspect the repository before choosing commands or implementation patterns.
- Keep frontend and Worker integration compatible with a single Cloudflare
  Worker deployment.
- Keep the Python agent independently deployable to LiveKit Cloud.

## Verification

Use the repository's documented test, typecheck, build, and lint commands once
they exist. Until then, clearly report which verification could and could not be
performed.

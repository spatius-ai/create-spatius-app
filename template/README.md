# Spatius app

This project is a framework-neutral starting point for a Spatius application.
Its three parts are intentionally separated while their implementation choices
remain open.

See `AGENTS.md` for machine-oriented architecture and safety guidance.

## Project structure

- `web/` will contain the web frontend.
- `worker/` will contain the Cloudflare Worker backend.
- `agent/` will contain the Python LiveKit agent.

The frontend assets and backend will eventually be built and deployed together
as one Cloudflare Worker. The Python agent will be deployed separately to
LiveKit Cloud.

Framework selection, local development commands, environment variables,
authentication, and deployment configuration will be added in a later
iteration.

# AGENTS.md

## Project purpose

A Spatius voice-avatar application: `web/` contains React and AvatarKit,
`worker/` contains the Cloudflare Worker API, and `agent/` contains the Python
LiveKit agent. Frontend assets and API deploy as one Cloudflare Worker;
the Python agent deploys separately to LiveKit Cloud.

## Commands

Run from the project root:

- Install JavaScript dependencies: `__SPATIUS_JAVASCRIPT_INSTALL_COMMAND__`
- Install Python dependencies: `__SPATIUS_PYTHON_INSTALL_SUMMARY__`
- Start both services: `__SPATIUS_DEV_COMMAND__`
- Start only frontend/Worker: `__SPATIUS_WEB_DEV_COMMAND__`
- Start only the Python agent: `__SPATIUS_AGENT_DEV_COMMAND__`
- Check frontend/Worker: `__SPATIUS_CHECK_COMMAND__`
- Check Python: `__SPATIUS_AGENT_CHECK_COMMAND__`
- Check browser flows with mocks: `__SPATIUS_E2E_COMMAND__`

All checks can run after dependency installation, before credential setup.
Browser tests require Chromium; see README.md for the installation command.
Wrangler generates the ignored `worker-configuration.d.ts` during installation
and before lint, type checking, and builds. Update `wrangler.jsonc` to change bindings.

## Working guidelines

- Keep secrets out of browser code, logs, and commits. Local secrets live in
  ignored `.dev.vars` and `agent/.env.local` files.
- Run `npx create-spatius-app setup . --interactive` only with the user's
  agreement, a human present, and a secure PTY. Never request secrets in chat
  or bypass CI/non-interactive restrictions. Setup is local-only; do not
  authenticate or deploy implicitly.
- Keep avatar and voice selection in Worker configuration, passed through the
  versioned contract in `contracts/agent-dispatch-metadata.schema.json`.
  Keep the dispatched agent name synchronized with the Python registration.
  Spatius resolves its region automatically; do not add `SPATIUS_REGION`.
- Preserve explicit conversation start, a single LiveKit room/microphone/audio
  renderer, Spatius attachment before connection, and teardown on exit or
  failure. Use AvatarKit for rendering, not a conventional video track.
- Keep transcripts synchronized with speech and interruptions. Read the
  existing implementation before changing session ownership or playback.
- Run the checks above after changes. Use mocks for automated tests, not real
  provider accounts. Add appropriate protection to the public session endpoint
  before using this demo in production.

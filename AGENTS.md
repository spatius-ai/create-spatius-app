# AGENTS.md

## Repository purpose

This repository contains the `create-spatius-app` project generator. The first
template is intentionally opinionated: React, Cloudflare Workers, LiveKit
Agents, LiveKit Inference, and the Spatius avatar integration.

## Commands

- Install dependencies: `pnpm install --frozen-lockfile`
- Run all required checks: `pnpm check`
- Run unit tests: `pnpm test`
- Run unit tests with coverage thresholds: `pnpm test:coverage`
- Run end-to-end tests: `pnpm test:e2e`
- Test generated development process supervision: `pnpm test:dev`
- Verify generated desktop/mobile UI with mocks: `pnpm template:test:e2e`
- Validate peer dependencies: `pnpm dependencies:check`
- Build the published executable: `pnpm build`
- Verify the npm package: `pnpm package:check`
- Generate and fully verify an application: `pnpm template:check`

## Architecture

- `src/` contains argument handling, interaction policy, output contracts,
  validation, and scaffolding behavior.
- `src/templates.ts` is the typed internal template registry. Its default is
  `cloudflare-livekit`; the public CLI still reports `template: "default"`.
- `src/templates/<id>/` owns each template's file selection and mapping,
  configuration, install plan, setup recognition and workflow, component
  descriptions, next steps, and verification variants.
- `templates/<id>/` contains files copied into generated projects.
- `schemas/` contains stable machine-readable CLI output schemas.
- `tests/unit/` covers isolated behavior.
- `tests/e2e/` exercises the built and packed command.

## Constraints

- Never overwrite a non-empty destination.
- Keep non-interactive execution deterministic and free of prompts.
- Keep `--json` output to one JSON document with no decorative output.
- Treat JSON schemas, error codes, flags, defaults, and exit codes as public
  interfaces.
- Authentication and browser opening may occur only in the secure interactive
  credential-setup flow. Never trigger them in CI, JSON, dry-run, `--yes`,
  non-TTY, or ordinary detected-agent execution.
- Do not add implicit deployment, telemetry, or destructive behavior.
- Keep provider-specific code within the generated `web/`, `worker/`, and
  `agent/` boundaries and their generator adapter so future template variants
  can evolve independently. Shared scaffolding, interaction, and installation
  execution must delegate template behavior to the selected registry entry.
- Resolve bundled template assets relative to the installed generator package,
  never the caller's working directory. Setup must still recognize projects
  created before the registry existed.
- Keep LiveKit and Spatius secrets out of generated browser code.
- Keep the frontend assets and API compatible with one Cloudflare Worker
  deployment, while the Python agent remains independently deployable.
- Any CLI-interface change requires end-to-end coverage of the built command.
- Any package-layout change requires coverage of the packed npm artifact.

## Definition of done

Run `pnpm check` after making changes. When `templates/` or a template adapter
changes, also run
`pnpm template:check`. Do not consider work complete until the relevant full
commands pass. Do not commit `dist/`, coverage output, package tarballs,
dependency directories, or local package-manager stores.

See `CONTRIBUTING.md` for the internal template-entry workflow and verification
requirements. Adding an internal entry does not authorize new CLI flags or a
change to the published output schema.

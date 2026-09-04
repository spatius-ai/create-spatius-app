# AGENTS.md

## Repository purpose

This repository contains the `create-spatius-app` project generator. The
generated application is currently a framework-neutral placeholder; production
web, Cloudflare Worker, and LiveKit agent choices are intentionally deferred.

## Commands

- Install dependencies: `pnpm install --frozen-lockfile`
- Run all required checks: `pnpm check`
- Run unit tests: `pnpm test`
- Run unit tests with coverage thresholds: `pnpm test:coverage`
- Run end-to-end tests: `pnpm test:e2e`
- Validate peer dependencies: `pnpm dependencies:check`
- Build the published executable: `pnpm build`
- Verify the npm package: `pnpm package:check`

## Architecture

- `src/` contains argument handling, interaction policy, output contracts,
  validation, and scaffolding behavior.
- `template/` contains files copied into generated projects.
- `schemas/` contains stable machine-readable CLI output schemas.
- `tests/unit/` covers isolated behavior.
- `tests/e2e/` exercises the built and packed command.

## Constraints

- Never overwrite a non-empty destination.
- Keep non-interactive execution deterministic and free of prompts.
- Keep `--json` output to one JSON document with no decorative output.
- Treat JSON schemas, error codes, flags, defaults, and exit codes as public
  interfaces.
- Do not add implicit authentication, browser opening, deployment, telemetry,
  or destructive behavior.
- Keep the generated template framework-neutral until those choices are made.
- Any CLI-interface change requires end-to-end coverage of the built command.
- Any package-layout change requires coverage of the packed npm artifact.

## Definition of done

Run `pnpm check` after making changes. Do not consider work complete until the
full command passes. Do not commit `dist/`, coverage output, package tarballs,
dependency directories, or local package-manager stores.

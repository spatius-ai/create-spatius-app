# AGENTS.md

## Terminal UI previews

When a terminal recording would help review a CLI presentation change, follow
`skills/record-terminal.md` to generate one locally on demand. Recording is not
a required CI check or a requirement for every pull request.

## Repository purpose

This repository contains the `create-spatius-app` project generator. The first
template is intentionally opinionated: React, Cloudflare Workers, LiveKit
Agents, LiveKit Inference, and the Spatius avatar integration.

## README guidelines

Keep the root `README.md` minimal and written for humans landing on GitHub.
It is part of user onboarding: prioritize quick-start commands, essential
prerequisites, and brief instructions for using the starter CLI.

Do not add maintainer-only details, repository development instructions,
implementation internals, or long reference material. Put contributor guidance
in `CONTRIBUTING.md`, coding-agent workflows in `skills/`, and application
details in the generated project's documentation.

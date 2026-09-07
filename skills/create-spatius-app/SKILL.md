---
name: create-spatius-app
description: Bootstrap a Spatius voice-avatar application with create-spatius-app, including dependencies, human-assisted local credentials, verification, and local startup. Use when creating a new Spatius app or resuming its initial setup, not for general application customization or deployment.
license: MIT
---

# Bootstrap a Spatius application

Use the generator rather than assembling the template yourself. Choose a stack
first, then a compatible scenario. LiveKit stacks use React with Spatius avatars,
Cloudflare or Railway web hosting, and a Python agent on LiveKit Cloud or Railway.
LiveKit Cloud supplies RTC and inference in every LiveKit stack. Available scenarios
are minimal, tutoring, live streaming, customer service, and companion.

## 1. Choose the invocation and destination

- Require Node.js 22 or newer. Check available tools with bounded version
  probes; do not install system tools or provider CLIs implicitly.
- Use the published npm CLI. Check its version and help before creating:

  ```sh
  npx create-spatius-app --version
  npx create-spatius-app --help
  ```

  **Release prerequisite:** this CLI was unpublished when this skill was added.
  If npm cannot resolve it, report whether publication, network access, or
  authentication is blocking setup. Do not clone or build the generator as a
  fallback. Reuse the same CLI version for this entire setup.

- Respect the requested destination. If unspecified, propose `my-spatius-app`
  in the intended parent directory. Use `.` only when that directory is empty;
  installing a skill into a project can itself make the directory non-empty.
- For an existing generated app, read its `AGENTS.md` and README and resume the
  missing steps instead of running creation again. For an unrelated non-empty
  destination, ask for another location; never delete files or choose a new
  location silently.
- Honor requested package managers. Otherwise prefer available pnpm, then Bun,
  then npm; prefer uv over pip. Ask only when a missing prerequisite or choice
  blocks the intended workflow. Scaffold-only creation can record explicitly
  selected managers even when they are unavailable locally.

## 2. Preview and create without prompts

Use explicit manager flags, `--no-interactive`, `--no-setup`, and `--json`.
For a normal bootstrap that includes dependency installation, preview first:

```sh
npx create-spatius-app my-spatius-app --package-manager pnpm --python-package-manager uv --no-interactive --no-setup --install --dry-run --json
```

Inspect the result, then run the same command without `--dry-run`:

```sh
npx create-spatius-app my-spatius-app --package-manager pnpm --python-package-manager uv --no-interactive --no-setup --install --json
```

Substitute the chosen destination and managers in both commands. Quote paths
with spaces using the current shell's syntax, or pass an argument array when
the agent's process tool supports it. These are examples, not fixed choices.
If installation is outside the request, use `--no-install` in the preview and
creation instead; the scaffold-only creation command is:

```sh
npx create-spatius-app my-spatius-app --package-manager pnpm --python-package-manager uv --no-interactive --no-setup --no-install --json
```

Check both the process exit status and the JSON document. Current successful
results have `schemaVersion: 3`, `ok: true`, `projectDirectory`,
`packageManagers`, `actions`, and `nextSteps`; dry-run lists `wouldCreate`
without creating files. Help and version remain plain text, not JSON.

On failure, use `error.code` and `error.recovery` rather than parsing decorative
output. A failed dependency install can leave a valid generated project: inspect
it and retry the documented installation commands there, not creation. Never
delete the app to recover. If the same cause recurs, stop and report what needs
to change rather than retrying indefinitely. Do not execute returned commands
blindly: check that they fit the user's scope and selected CLI source.

## 3. Configure local credentials with the human

Keep authentication separate from machine-readable creation. Explain that it
configures local development only, then obtain the user's agreement to start
the browser/TTY-assisted wizard. With a human present and a secure interactive
terminal, run:

```sh
npx create-spatius-app setup my-spatius-app --interactive
```

Use the actual target, or `setup . --interactive` from inside it. Delegate
LiveKit credentials, Spatius login, app/key selection or creation, avatar and
background selection, and feminine/masculine voice choice to the wizard. Do not
reimplement provider authentication or automatically approve remote mutations.

Without a human or suitable PTY, provide the exact command for them to run and
mark credentials as pending. Never bypass restrictions by unsetting CI/agent
markers or enabling test-only environment variables. Do not combine setup with
`--json`, `--yes`, or `--dry-run`, or pipe secrets/approval answers into it.

Do not ask for secrets in chat, read out the resulting files, or log their
values. The ignored files are `.dev.vars` (Cloudflare) or `.env.local` (Node),
and `agent/.env.local` for LiveKit. Existing
credentials stay unchanged unless the user explicitly replaces them. If the
wizard is unavailable, point to the generated README's manual instructions for
the user to follow locally. Cancellation leaves setup pending, not permission
to try another authentication route automatically.

## 4. Verify, start, and hand off

Read the generated `AGENTS.md`, README, and package scripts. Use their
manager-specific installation, frontend/API check, Python check when present, and unified
development commands; do not maintain a parallel command catalog in this skill.
If dependencies were intentionally skipped, report those checks as pending.

Once credentials are ready and starting the app is within the request, run the
unified development command using the agent's managed terminal/background-process
facility. Report the actual URL from its output and whether both services are
running. If long-running processes cannot be retained, provide the command for
the user instead. Do not leave duplicate servers behind on retries; stop only
processes you started. Keep startup failures visible and explain the next action.

Leave microphone access and **Start conversation** to the user. Do not call
the session endpoint, dispatch an agent, or synthesize speech solely to claim a
successful smoke test. Starting the development agent connects to LiveKit;
do not do so when the user requested offline checks only.

Finish with the project location, selected managers, completed checks, service
status/URL, and outstanding human steps. Distinguish **scaffolded**, **verified**,
and **running**; a successful generator exit does not prove live provider health.
Hand ongoing customization to the project's `AGENTS.md`. Deployment, installing
other skills, publishing, and changing unrelated agent configuration are not
part of this workflow.

## Stack and template selection

Use `--stack` and `--template` for deterministic generation. Stack selection precedes template selection, and singleton choices are automatic. Use `--help` for available values. JSON schema version 3 reports both values. Defaults are `cloudflare-livekit` and `minimal`.

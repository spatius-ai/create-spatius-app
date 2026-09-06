# create-spatius-app

Bootstrap a voice agent application with Spatius avatar.

## Usage

Create a project interactively:

```sh
npx create-spatius-app
```

Or provide the destination directly:

```sh
npx create-spatius-app my-spatius-app
```

Use the defaults without prompts:

```sh
npx create-spatius-app --yes
```

The interactive flow offers only package managers detected on the current
machine. Pin choices for repeatable runs, and opt into installation when
desired:

```sh
npx create-spatius-app my-app \
  --package-manager pnpm \
  --python-package-manager uv \
  --install
```

JavaScript package-manager choices are ordered pnpm, Bun, then npm, showing only
tools detected on your system. Supported Python package managers are uv and pip.
Explicit choices may be used with
`--no-install` even when the manager will only be available in another
environment. Non-interactive mode prefers the invoking JavaScript manager and
otherwise defaults to npm; Python defaults to uv. Scaffold-only and dry-run
commands do not execute package-manager probes. When installation is requested,
the CLI verifies the selected tools and, for unspecified choices, uses the
first detected supported option while preferring uv over pip.

Generated npm and pnpm projects include their matching lockfile. Bun creates
`bun.lock` when dependency installation runs.

For deterministic agent or CI usage, explicitly disable prompts and request a
machine-readable result:

```sh
npx create-spatius-app my-app \
  --no-interactive \
  --package-manager npm \
  --python-package-manager pip \
  --no-install \
  --json
```

Inspect the complete file plan without writing anything:

```sh
npx create-spatius-app my-app --dry-run
npx create-spatius-app my-app --no-interactive --dry-run --json
```

## Guided local credentials

Human TTY creation offers to configure LiveKit and Spatius credentials after
scaffolding and optional dependency installation. Skip that offer explicitly
with `--no-setup`, or request it with `--setup`:

```sh
npx create-spatius-app my-app --setup --interactive
npx create-spatius-app my-app --no-setup
```

The wizard is rerunnable from a generated project:

```sh
npx create-spatius-app setup . --interactive
```

It can load LiveKit project credentials through a compatible `lk app env`
command or accept them through masked prompts. For Spatius, it uses a temporary
browser-approved PKCE login to select or explicitly create an app and API key,
then select an avatar. Existing complete credentials are preserved by default,
and no managed value is replaced without confirmation.

The setup command writes only the ignored local-development files `.dev.vars`
and `agent/.env.local`. It does not upload Cloudflare secrets, configure a
LiveKit Cloud deployment, persist the Spatius login, or deploy anything. CI,
JSON, dry-run, `--yes`, non-TTY, and ordinary detected-agent runs never launch
authentication or secret prompts. A coding agent must opt in with both a PTY
and `--setup --interactive`, or run the standalone command above. Manual-copy
instructions remain in every generated project's README.

For Spatius setup diagnostics, add `--debug`:

```sh
npx create-spatius-app setup . --interactive --debug
```

Diagnostics go to stderr and include request method, route, timing, HTTP status,
and recognized API error codes. They omit headers, query values, bodies, tokens,
and credentials. No log file is written automatically. An HTTP `200` can still
contain a Spatius console API error; the CLI reports the application error as a
failure. If it reports a missing `SERVER_OPEN_PLATFORM_FRONTEND_URL`, configure
the Studio origin in the **console service deployment**, then retry setup.
That setting does not belong in the generated project's environment files.

## Agent-native behavior

- `--interactive` forces prompts, including when stdin is piped.
- `--no-interactive` forbids prompts and uses documented safe defaults.
- `--yes` accepts safe defaults; it never authorizes overwrites or external
  actions.
- `--install` runs both selected dependency installers. `--no-install` skips
  them; unattended runs skip installation when neither flag is supplied.
- pip setup creates `agent/.venv` and never installs the agent into the global
  Python environment.
- Non-TTY, CI, and recognized coding-agent environments default to
  non-interactive behavior unless `--interactive` is explicit.
- Credential setup is stricter: detected agents must explicitly request
  `--setup --interactive`; `--interactive` alone does not authorize it.
- `--json` implies non-interactive behavior and emits exactly one JSON result.
- `--dry-run` validates the destination and template without modifying the
  filesystem.

Successful JSON results use exit status `0`. Invalid arguments use `2`, target
conflicts use `3`, filesystem or template failures use `4`, and cancellation
uses `130`. JSON errors include stable symbolic codes and recovery guidance.
The versioned result contract is published in
[`schemas/result-v2.schema.json`](./schemas/result-v2.schema.json). The previous
v1 contract remains in the published package for reference.

`--help` and `--version` remain plain-text discovery commands even when
`--json` is also present.

The generated project contains an agent-readable `AGENTS.md` plus an
opinionated first-party template:

- a React and Vite frontend using Spatius AvatarKit;
- a Cloudflare Worker that creates LiveKit tokens and explicitly dispatches
  the agent;
- a Python LiveKit Agents worker using LiveKit Inference and the Spatius
  plugin.

The frontend assets and API deploy as one Cloudflare Worker. The Python agent
deploys separately to LiveKit Cloud. The generator installs dependencies only
after an interactive confirmation or an explicit `--install`. It does not
initialize a nested Git repository or deploy anything; authentication and
browser opening are confined to the explicitly controlled credential wizard.

The terminal accents reuse the redesigned Spatius marketing palette: indigo
`#6363A7`, highlight `#9399E3`, and deep ink `#151131`. Color is disabled for
non-TTY output and when `NO_COLOR` is present.

## Development

Requirements:

- Node.js 22 or newer
- pnpm 11.1.2

Install dependencies and run the complete verification suite:

```sh
pnpm install
pnpm check
```

Run the slower generated-application verification when changing `templates/`
or a template adapter:

```sh
pnpm template:check
pnpm template:test:e2e
```

This creates applications in temporary directories, exercises both the
pnpm/uv and npm/pip installation paths, and runs the generated projects'
JavaScript, Worker, build, and Python checks.
The browser command additionally runs mocked desktop/mobile conversation tests
in Chromium. `pnpm check` includes the development launcher's fake-process
tests, including sibling-exit and Ctrl+C cleanup, on the CI platform matrix.

The typed internal registry in `src/templates.ts` currently contains one entry,
`cloudflare-livekit`, whose assets live in `templates/cloudflare-livekit/`.
File selection, configuration, dependency installation plans, credential setup,
component descriptions, and next steps belong to that entry. Package and
generated-application verification iterate the registry. This is an internal
extension point: there is no template-selection CLI flag, and successful JSON
results continue to report `"template": "default"`. Existing generated projects
remain compatible with the standalone setup command.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the process of adding an internal
template entry and verifying the packed executable outside the repository.

Run the TypeScript entrypoint during development:

```sh
pnpm dev -- my-app
```

Build and run the distributable executable:

```sh
pnpm build
node dist/cli.js my-app
```

## License

[MIT](./LICENSE)

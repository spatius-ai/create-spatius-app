# create-spatius-app

Bootstrap a voice agent application with Spatius avatar.

## Usage

create a project interactively:

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

For deterministic agent or CI usage, explicitly disable prompts and request a
machine-readable result:

```sh
npx create-spatius-app my-app --no-interactive --json
```

Inspect the complete file plan without writing anything:

```sh
npx create-spatius-app my-app --dry-run
npx create-spatius-app my-app --no-interactive --dry-run --json
```

## Agent-native behavior

- `--interactive` forces prompts, including when stdin is piped.
- `--no-interactive` forbids prompts and uses documented safe defaults.
- `--yes` accepts safe defaults; it never authorizes overwrites or external
  actions.
- Non-TTY, CI, and recognized coding-agent environments default to
  non-interactive behavior unless `--interactive` is explicit.
- `--json` implies non-interactive behavior and emits exactly one JSON result.
- `--dry-run` validates the destination and template without modifying the
  filesystem.

Successful JSON results use exit status `0`. Invalid arguments use `2`, target
conflicts use `3`, filesystem or template failures use `4`, and cancellation
uses `130`. JSON errors include stable symbolic codes and recovery guidance.
The versioned result contract is published in
[`schemas/result-v1.schema.json`](./schemas/result-v1.schema.json).

`--help` and `--version` remain plain-text discovery commands even when
`--json` is also present.

The generated project contains an `AGENTS.md` file plus `web/`, `worker/`, and
`agent/` directories. This initial version does not install dependencies,
initialize a nested Git repository, authenticate with providers, or deploy
anything.

## Development

Requirements:

- Node.js 22 or newer
- pnpm 11.1.2

Install dependencies and run the complete verification suite:

```sh
pnpm install
pnpm check
```

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

# Release verification checklist

Use this maintainer checklist for each release. Keep this material out of the
onboarding README. Record verification results with the release or pull request.

## Verify after publication

- [ ] Verify npm dist-tags and confirm `npx create-spatius-app --version`
      resolves to the intended stable release. For a prerelease, check `@beta`
      explicitly and confirm `latest` still points to the intended stable version.
- [ ] Verify the skill is on the default branch and can be discovered using
      `npx skills add spatius-ai/create-spatius-app --list`. Confirm the documented
      `--skill create-spatius-app` installation works in an isolated test location.
- [ ] Smoke-test the public CLI from outside a checkout: help/version, JSON
      dry-run, and scaffold-only creation. Set `--no-install`, `--no-setup`, and
      `--no-interactive` explicitly. Verify setup command resolution with
      `setup --help`; browser authentication remains a separate, explicitly
      approved human smoke test.

Review these public command locations together. Use `@beta` for prerelease
smoke tests; keep onboarding examples on the stable command:

| Command                                                                   | Locations to verify                                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npx create-spatius-app …`                                                | Root README and `skills/create-spatius-app/SKILL.md`                                                       |
| `npx create-spatius-app setup . --interactive`                            | Generated root README, AGENTS.md, agent README, and `src/templates/cloudflare-livekit/index.ts` next steps |
| `npx skills add spatius-ai/create-spatius-app --skill create-spatius-app` | Root README                                                                                                |

## Template command placeholders: keep in source

These are **not release TODOs**. The generator already replaces them when
creating a project, using the selected package managers and operating system.
Do not bulk-replace them with pnpm, npm, Bun, uv, or pip commands in the template.
The source of truth is `createReplacements` in
`src/templates/cloudflare-livekit/configure.ts`.

| Placeholder                              | Rendered value                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `{{SPATIUS_JAVASCRIPT_PACKAGE_MANAGER}}` | Selected JavaScript manager and known version                                 |
| `{{SPATIUS_PYTHON_PACKAGE_MANAGER}}`     | Selected Python manager and known version                                     |
| `__SPATIUS_JAVASCRIPT_INSTALL_COMMAND__` | Selected JavaScript dependency-install command                                |
| `__SPATIUS_PYTHON_INSTALL_COMMANDS__`    | uv/pip installation commands, with platform-correct virtual-environment paths |
| `__SPATIUS_PYTHON_INSTALL_SUMMARY__`     | The same Python installation commands on one line                             |
| `__SPATIUS_DEV_COMMAND__`                | Unified development command, e.g. `pnpm run dev`                              |
| `__SPATIUS_WEB_DEV_COMMAND__`            | Selected manager's `dev:web` script                                           |
| `__SPATIUS_AGENT_DEV_COMMAND__`          | Selected manager's `agent:dev` script                                         |
| `__SPATIUS_CHECK_COMMAND__`              | Selected manager's `check` script                                             |
| `__SPATIUS_AGENT_CHECK_COMMAND__`        | Selected manager's `agent:check` script                                       |

The renderer also retains these mappings, currently unused by the shortened
documentation. They are not pending public command replacements either:

| Placeholder                               | Rendered value                                 |
| ----------------------------------------- | ---------------------------------------------- |
| `__SPATIUS_CF_TYPEGEN_COMMAND__`          | Selected manager's `cf-typegen` script         |
| `__SPATIUS_DEPLOY_COMMAND__`              | Selected manager's `deploy` script             |
| `__SPATIUS_WRANGLER_LOGIN_COMMAND__`      | Selected manager's Wrangler login invocation   |
| `__SPATIUS_WRANGLER_API_KEY_COMMAND__`    | Wrangler secret entry for `LIVEKIT_API_KEY`    |
| `__SPATIUS_WRANGLER_API_SECRET_COMMAND__` | Wrangler secret entry for `LIVEKIT_API_SECRET` |

- [ ] Generate projects for all supported package-manager combinations and
      confirm these tokens are absent from their rendered documentation.
- [ ] Run `pnpm check` and `pnpm template:check` after release-related edits.

Example project names, example environment values, and local filesystem paths
remain examples. Never replace credential placeholders with real credentials
in this repository or a published template.

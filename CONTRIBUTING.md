# Contributing

Before the first npm release, follow the
[release documentation checklist](RELEASE_CHECKLIST.md).

Use Node.js 22 or newer and the pnpm version pinned in `package.json`. Read
`AGENTS.md` before editing, then install with `pnpm install --frozen-lockfile`.
Run `pnpm check` for the required formatting, lint, type, dependency, unit,
end-to-end, and package checks. Run `pnpm template:check` when changing template
assets or an adapter; it generates temporary projects and fully verifies each
registered template's package-manager variants.

## Terminal recordings

Generate terminal previews on demand when reviewing CLI presentation changes.
Recordings run locally, are not part of CI, and are not committed to the
repository. Coding agents can follow the
[terminal recording workflow](skills/record-terminal.md) to create and share
a preview from their coding environment.

To record locally on macOS or Linux, install Python 3, [agg 1.9.0](https://github.com/asciinema/agg),
and FFmpeg, then run `pnpm terminal:record`. Files are written under
`test-results/terminal/`. Set `AGG` to an executable path if agg is not on PATH.
For a transcript without rendering tools, run `pnpm build` followed by
`python3 scripts/record-terminal.py`.

The recorder runs the actual built CLI in an 80 × 30 pseudo-terminal. It waits
for each prompt before typing scripted answers and fails if onboarding stalls
or does not finish. Dependency commands are offline stubs with short delays;
credential setup is skipped. It exercises presentation, not real installation
or provider authentication. The recording uses a temporary project and an
isolated environment without local credentials. Update the prompt/answer script
when intentionally changing the onboarding flow.

## Internal template entries

`src/templates.ts` defines a typed registry with one current entry,
`cloudflare-livekit`. It is the default for creation. The CLI flags, package
manager defaults, interaction policy, errors, and output schemas are public
interfaces; the internal registry does not add a public template selector.
Successful JSON output still uses `"template": "default"`.

To add a future internal entry:

1. Add its assets under `templates/<id>/`, including package-safe example
   filenames and exclusions for credentials, dependency directories, build
   output, and test artifacts. Use its adapter to restore reserved dotfiles.
2. Implement `TemplateDefinition` under `src/templates/<id>/`. Keep file
   inclusion and path mapping, package-manager configuration, install plans,
   setup recognition and workflow, descriptions, next steps, and verification
   variants in the adapter. Shared code owns safe copying, rollback, process
   execution, and the interaction policy.
3. Register it in `src/templates.ts`. Keep the explicit default unchanged
   unless a separately reviewed product change calls for another default.
   Resolve assets relative to the installed generator package. The internal
   `dist/templates.js` bundle lets verification scripts use the same registry
   without adding CLI flags or publishing a supported library API.
4. Define setup recognition that accepts the entry's supported previous
   layouts and rejects unrelated projects. Recognition must not authenticate,
   open a browser, read credentials, or write files. Run the setup workflow only
   after the CLI's existing secure interaction decision allows it. Ambiguous
   matches must fail rather than select an arbitrary workflow.
5. Add independent fixture tests for selection and shared delegation, plus
   adapter tests for its actual generated behavior. Use temporary directories;
   never write fixtures into shipped template assets or mutate the singleton
   registry. Check that dry-run paths match created files and unsafe or
   colliding mappings fail before writes.
6. Run `pnpm check` and `pnpm template:check`. The package checker derives the
   required asset paths from every registered verification variant; make the
   variants cover all alternative source files, including lockfiles and
   Dockerfiles. The packed-command tests must run an installed npm artifact
   from a directory outside the repository.

The `pnpm template:test:e2e` command builds the CLI and runs Chromium
tests after the pnpm/uv JavaScript checks for each entry. It installs Chromium
(including system dependencies on Linux), retains output under
`test-results/<id>/`, and continues the normal full verification. Use it when
the generated template includes Playwright configuration and `test:e2e`.
Failures forward subprocess stdout and stderr before temporary-project cleanup.

## Change boundaries

Keep template and provider behavior in its adapter and generated application.
Keep secrets out of browser code, preserve deterministic non-interactive
execution, and never add implicit deployment or overwrite a non-empty target.
CLI-interface changes require built-command end-to-end coverage. Package-layout
changes require packed-artifact coverage. Do not commit `dist/`, coverage,
dependency stores, npm tarballs, or browser test output.

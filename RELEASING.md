# Publishing create-spatius-app

## Release rules

The existing `ci.yml` verifies pull requests and pushes to `main` across Linux,
macOS, Windows, and Node.js 22/24, and tests a generated application.
`publish.yml` runs when a GitHub release is **published**, including a prerelease
published from a draft. Creating a tag or saving a draft alone does not publish.

The release tag is the source of truth for the npm version. Use `v` followed by
canonical SemVer without build metadata. Its commit must be reachable from
`origin/main`; it does not have to be the current tip. CI validates the tag and
GitHub pre-release checkbox, rejects a version that already exists on npm, and
sets the root `package.json` version in its temporary checkout before installing,
building, testing, or publishing. Registry errors stop the release.

No version-bump PR is needed. CI never commits the version change or pushes to
`main`. The source manifest keeps its development version; the published npm
manifest and CLI `--version` use the release tag's version. Template application
versions and the pnpm lockfile are unchanged.

The workflow verifies the generated application and browser interactions, then
runs `npm publish`. The existing `prepublishOnly` hook runs `pnpm check`, including
packed-CLI tests, and `prepack` builds the CLI.

| GitHub tag      | GitHub pre-release checkbox | npm channel |
| --------------- | --------------------------- | ----------- |
| `v0.1.0-beta.1` | Checked                     | `beta`      |
| `v0.1.0-rc.1`   | Checked                     | `beta`      |
| `v0.1.0`        | Unchecked                   | `latest`    |

A prerelease tag with an unchecked checkbox, or a plain stable tag with a checked
checkbox, is rejected before the manifest changes. The GitHub release title is
only a display label; it does not determine the version or npm channel.

npm versions are immutable. Editing a GitHub release checkbox does not promote
an npm version. To graduate a beta, publish a new normal release such as `v0.1.0`
after `v0.1.0-beta.2`.

## Publish a release

1. Merge feature, fix, and dependency PRs into `main` as usual. Leave the root
   package version alone. Wait for CI to pass on the code you want to release.
2. Check existing GitHub tags and npm versions, then choose an unused version
   appropriate to the changes. The table above illustrates the channel rules;
   its versions are examples, not suggestions for the next release.
   In GitHub, open **Releases → Draft a new release**, create a new tag
   `v<version>` targeting the verified commit on `main`, and add release notes.
   For a stable version, leave **Set as a pre-release** unchecked (`latest`).
   For a prerelease version, check it (`beta`).

3. Click **Publish release**. CI derives the npm version from the tag; do not
   run `npm version` or `npm publish` locally for routine releases.
4. Watch **Actions → Publish to npm**. The workflow reruns checks for the tagged
   commit before publishing. Publish one release at a time and wait for it to
   finish: npm channel tags point to the last version published to that channel,
   not necessarily the highest version. GitHub concurrency prevents overlap but
   is not a FIFO release queue.
5. Verify the registry and run the CLI from outside the checkout:

   ```sh
   npm view create-spatius-app dist-tags
   npx create-spatius-app --version
   npx create-spatius-app --help
   ```

   For a prerelease, use `create-spatius-app@beta` in both commands. Confirm the
   selected channel resolves to the version just published and complete
   [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Repository README and template
   edits ship to npm with a new package release; they do not update older
   package versions or previously generated projects.

## Trusted-publisher configuration reference

The package is already published. Maintain npm ownership separately from GitHub
organization membership: this package is unscoped. Keep GitHub Actions enabled,
protect `main` with CI checks, restrict creation/movement of `v*` tags to release
maintainers, and keep the repository public for the workflow’s provenance setup.

On npm, **create-spatius-app → Settings → Trusted publishing** should configure
**GitHub Actions** with:

| Field                | Value                                      |
| -------------------- | ------------------------------------------ |
| Organization or user | `spatius-ai`                               |
| Repository           | `create-spatius-app`                       |
| Workflow filename    | `publish.yml`                              |
| Environment name     | Leave blank (the job does not declare one) |
| Allowed actions      | Allow direct `npm publish`                 |

No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. The workflow grants
`id-token: write` and selects Node 24 with a compatible bundled npm. Keep
`publishConfig.provenance` enabled.

## Failures and retries

- For an invalid tag, inconsistent pre-release checkbox, or a commit outside
  `main`, create a correctly configured release from `main`. Do not move already
  published tags. Edits to existing release metadata do not trigger publishing.
- For authentication failures, verify all trusted-publisher fields, permission
  for direct `npm publish`, and the public repository URL in `package.json`.
- If a run fails before publishing, fix the external setup and rerun the failed
  job. If the code needs changing, create a new version and release.
- If upload may have succeeded, check `npm view create-spatius-app@<version>`
  before retrying. npm cannot overwrite an existing version, including after
  unpublishing. Deleting a GitHub release does not remove its npm package.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[GitHub release events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release),
[npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/), and
[npm publish](https://docs.npmjs.com/cli/commands/npm-publish/).

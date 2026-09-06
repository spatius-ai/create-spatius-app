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

## One-time setup

1. Confirm the npm account that will own `create-spatius-app`, enable 2FA, and
   check package-name availability with `npm view create-spatius-app`. If it
   exists, confirm publishing rights; an E404 means the package was not found,
   while authentication/network failures do not prove availability. The name
   is unscoped, so GitHub organization membership does not grant npm ownership.
2. Merge the publishing workflow and this guide into `main`. Enable GitHub
   Actions, protect `main` with the CI checks, and restrict creation/movement of
   `v*` tags to release maintainers. This workflow uses GitHub-hosted runners
   and provenance; keep the source repository public.
3. If the npm package does not exist yet, bootstrap it once from a clean
   checkout of `main`. Use Node.js 24 and the pnpm version pinned in
   `package.json`. Prepare `0.1.0-beta.0` with
   `npm version 0.1.0-beta.0 --no-git-tag-version`, commit the root
   `package.json` change, and merge it into `main` through normal review.
   From that exact commit, run:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm template:test:e2e
   npm login
   npm publish --tag beta --access public --provenance=false
   ```

   Install Python 3.13 and uv for template checks. The publish lifecycle also
   runs `pnpm check` and builds the package. This first local publish disables
   provenance because GitHub OIDC provenance is unavailable locally. Keep the
   committed `publishConfig.provenance` enabled. This bootstrap version is
   consumed; the first automated release must use a different version.

4. On npm, open **create-spatius-app → Settings → Trusted publishing**, choose
   **GitHub Actions**, and configure:

   | Field                | Value                                      |
   | -------------------- | ------------------------------------------ |
   | Organization or user | `spatius-ai`                               |
   | Repository           | `create-spatius-app`                       |
   | Workflow filename    | `publish.yml`                              |
   | Environment name     | Leave blank (the job does not declare one) |
   | Allowed actions      | Allow direct `npm publish`                 |

   No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. The workflow grants
   `id-token: write`. Trusted publishing requires npm 11.5.1+ and Node 22.14+;
   the workflow selects Node 24 with a compatible bundled npm. After a
   successful automated release, consider selecting npm's **Require two-factor
   authentication and disallow tokens** publishing setting.

## Publish each subsequent release

1. Merge feature, fix, and dependency PRs into `main` as usual. Leave the root
   package version alone. Wait for CI to pass on the code you want to release.
2. In GitHub, open **Releases → Draft a new release**. For the next beta, enter:

   | Field                | Value                            |
   | -------------------- | -------------------------------- |
   | Release title        | `v0.1.0-beta.1`                  |
   | Tag                  | Create new tag `v0.1.0-beta.1`   |
   | Target               | `main`, containing this workflow |
   | Set as a pre-release | Checked                          |

   Add release notes describing changes since the previous version. For later
   betas, increment to `v0.1.0-beta.2`, `v0.1.0-beta.3`, and so on. For stable,
   use `v0.1.0` and leave the pre-release checkbox unchecked.

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
   npx create-spatius-app@beta --version
   npx create-spatius-app@beta --help
   ```

   For stable, substitute `@latest`. Complete the smoke tests and documentation
   updates in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) after the first stable
   publication. A beta-only package does not make the README's unqualified
   stable commands ready; retain the availability notice until stable exists.
   The bootstrap publication also received a `latest` tag from npm, and removal
   returned HTTP 400. Until the first stable publication, use `@beta` explicitly
   for the newest beta and inspect dist-tags rather than assuming `latest` is stable.

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

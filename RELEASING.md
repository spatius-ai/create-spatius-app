# Publishing create-spatius-app

## Release rules

The existing `ci.yml` verifies pull requests and pushes to `main` across Linux,
macOS, Windows, and Node.js 22/24, and tests a generated application.
`publish.yml` runs when a GitHub release is **published**, including a prerelease
published from a draft. Creating a tag or saving a draft alone does not publish.

The release tag must be `v` followed by the exact root `package.json` version,
without SemVer build metadata. Its commit must be reachable from `origin/main`;
it does not have to be the current tip. The workflow checks out the event's
commit, validates these rules, verifies the generated application and browser
interactions, and runs `npm publish`. The existing `prepublishOnly` hook runs
`pnpm check`, including packed-CLI tests, and `prepack` builds the CLI.

| GitHub tag      | GitHub pre-release checkbox | npm channel |
| --------------- | --------------------------- | ----------- |
| `v0.1.0-beta.1` | Either                      | `beta`      |
| `v0.1.0-rc.1`   | Either                      | `beta`      |
| `v0.1.0`        | Checked                     | `beta`      |
| `v0.1.0`        | Unchecked                   | `latest`    |

Prefer explicit `-beta.N` versions for betas. npm versions are immutable: a plain
`0.1.0` published to `beta` cannot later be republished as `0.1.0`. Editing the
GitHub release checkbox does not promote an npm version. To graduate a beta,
publish a new normal release such as `0.1.0` after `0.1.0-beta.2`. If you already
published plain `0.1.0` to beta, use a new stable version such as `0.1.1`, or have
an authenticated maintainer explicitly move the existing version's dist-tag.

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

1. Choose a new version. For example, after bootstrap, prepare the next beta:

   ```sh
   npm version 0.1.0-beta.1 --no-git-tag-version
   ```

   For stable, use `npm version 0.1.0 --no-git-tag-version`. Change only the
   generator's root version; the generated application's version is independent.
   pnpm's lockfile does not contain the root package version.

2. Commit the version change, open a PR, wait for CI, and merge into `main`.
3. In GitHub, open **Releases → Draft a new release**. Create a new tag matching
   the version (`v0.1.0-beta.1`), select **main** as the target, add release notes,
   check **Set as a pre-release** for a beta, and click **Publish release**.
   For stable, use `v0.1.0` and leave the pre-release checkbox unchecked.
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

## Failures and retries

- For a version mismatch or a commit outside `main`, fix the source through a
  PR and create a new matching release. Do not move already published tags.
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

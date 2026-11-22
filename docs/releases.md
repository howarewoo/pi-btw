# Release guide

Publish deliberate, versioned npm releases of `@howarewoo/pi-btw`. GitHub releases use the
matching entry from `CHANGELOG.md`; Pi owns installation and updates. Publishing executes no
live model calls. The repository workflows do not publish on ordinary main-branch pushes.

## Version and compatibility policy

- During 0.x, use a patch for compatible fixes and polish, and a minor for new functionality
  or breaking changes. Label breaking changes and explain migration in the changelog.
- Move to 1.0 when the `/btw` command, hub controls and persisted thread format are stable.
  After 1.0, use semantic versioning: major for breaking changes, minor for compatible
  features, patch for compatible fixes.
- Commands, keybindings, the read-only tool allowlist and the hidden `howarewoo.btw.v1`
  session entries are user-facing contracts. A small implementation change can still require
  a breaking release.
- This pipeline publishes stable versions to npm's `latest` channel. Prerelease versions
  are rejected until a separate channel policy is added.
- **Minimum supported host: Pi 1.5.2. Tested host: Pi 1.6.0.** Development SDK packages are
  pinned to exactly 1.6.0, and the automated tests and package smoke test run against that
  version. Users may run newer Pi versions; the development pins do not constrain the
  installed host, but newer versions are not a tested compatibility guarantee and future
  breaking SDK changes may require an extension update. Wildcard host peer dependencies are
  required by Pi's package format, not a compatibility promise. The Node minimum is 22.19.0.
- Keep host development dependencies pinned, and verify SDK lifecycle, read-only tool
  enforcement, persistence/restore and native rendering before changing the minimum or
  claiming another tested Pi version.
- Never move a release tag, reuse a published version or overwrite retained user data.

## One-time setup

The package is already published (0.1.0 through 0.1.2), and 0.1.1 and 0.1.2 were published by
`release.yml` through npm trusted publishing with provenance. Repository settings inspected
read-only when this guide was written:

- The `npm` GitHub environment requires approval by `howarewoo` and restricts deployments to
  `v*` tags.
- `main` requires the `check (22.19.0)` and `check (24)` CI checks and resolved conversations.
- No repository rulesets were configured, so `v*` tag creation and deletion are not restricted
  to maintainers. Owners may add such a ruleset; this guide does not create it.
- The **PR title** check is not a required status check. Owners may add it to branch
  protection.

The npm trusted publisher for **`@howarewoo/pi-btw` → Settings → Trusted publishing** must
keep these values. Keep the workflow filename unchanged; renaming it breaks publication.

| Field                | Value         |
| -------------------- | ------------- |
| Organization or user | `howarewoo`   |
| Repository           | `pi-btw`      |
| Workflow filename    | `release.yml` |
| Environment name     | `npm`         |

The workflow uses GitHub-hosted runners, Node 24 and `id-token: write`; no `NPM_TOKEN` secret is
used. The publish helper refuses nonempty `NPM_TOKEN`/`NODE_AUTH_TOKEN` variables, requires a
GitHub OIDC context and npm 11.5.1 or newer. Do not use `npm whoami` to test OIDC: it does not
validate trusted publishing permissions. See
[npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for current
requirements. After successful OIDC publication, owners should restrict traditional token-based
publishing and revoke unused automation tokens.

Do not treat the workflow's `environment: npm` declaration as an approval rule: GitHub can create
an unprotected environment when a job references a new name. Reconfirm the environment and
trusted-publisher settings before a release if they may have changed.

## Contributor titles and release notes

Ordinary PRs do **not** edit `CHANGELOG.md`. Use `type(optional-scope)!: description`
for PR titles, with one of `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
`ci`, `chore`, `revert` or `style`. For example, `feat(hub): add thread search`
or `fix: correct startup label`. Describe user-visible changes and migration in the PR
body; use `!` for breaking changes and retain `BREAKING CHANGE:` footers in the final
commit body. These details are inputs to release review, not proof of migration completeness.

The read-only **PR title** workflow checks opened and edited titles (also reopened,
synchronized and ready-for-review PRs). It passes the title as environment data, never as
shell source, uses no secrets or elevated `pull_request_target` execution, and installs no
dependencies. Locally, run `PR_TITLE='fix: correct startup label' npm run pr-title:check`.

The repository allows merge commits, squash merges and rebase merges; squash titles use
`COMMIT_OR_PR_TITLE` and bodies use `COMMIT_MESSAGES`. Therefore a PR title is **not
guaranteed** to become the final commit title or preserve the PR description. Maintainers
should squash ordinary PRs and explicitly confirm the final conventional title and meaningful
body, including breaking/migration guidance. Generation uses first-parent history: a merge
commit is listed instead of its branch commits, and rebase merges may produce multiple entries.

## Prepare each release

1. Start from current `main`, with no unrelated local changes. Review the changes being released.
   Fetch complete history and tags first (for a shallow clone, `git fetch --unshallow --tags`;
   otherwise `git fetch --tags`). Identify the actual previous release tag; generation never
   guesses one from dates or version sorting and needs no GitHub API access.
2. On a release-preparation branch, update the manifest and lockfile without creating a tag:

   ```sh
   npm version 0.2.0 --no-git-tag-version
   ```

   Choose the actual next stable version according to the compatibility policy above.
   Preserve existing release tags and historical changelog entries.

3. Generate the new version section from the explicit prior release tag through current `HEAD`:

   ```sh
   npm run changelog:generate -- --from v0.1.2 --dry-run
   npm run changelog:generate -- --from v0.1.2
   ```

   Replace both example versions as appropriate. The target version comes from `package.json`.
   The preview prints the new section without writing; normal generation inserts it before the
   first historical release, after `Unreleased` if present. It leaves existing text unchanged.
   Existing nonempty `Unreleased` notes are **copied**, not silently moved or discarded, into
   **Previously curated notes** in the new section. Review these alongside generated entries
   to remove duplicates in the new section. Clear or move `Unreleased` notes only deliberately
   in the reviewed release PR after confirming their inclusion; otherwise they will be copied
   again next time. Generation itself never clears them.

   Entries retain subjects, PR-number suffixes and commit references, oldest first within
   each group: `feat` → **Features**, `fix`/`perf` → **Fixes and performance**, all other types
   → **Other changes**. Nonconventional legacy subjects are retained with warnings. Breaking
   `!` markers and `BREAKING CHANGE:` (also `BREAKING-CHANGE:`) body footers are surfaced in
   **Breaking changes**, independently of type. A marker without details asks for manual guidance.

   **Review and enrich the generated section** with migration, Pi compatibility and relevant
   persistence or read-only boundary changes. Commit metadata is only a starting point. Do not
   promise verification that has not run. Keep README installation/migration examples current.

   Missing or nonancestor tags, shallow/incomplete history, an empty range, unstable versions
   and duplicate version headings fail before writing. Fix the input or fetch full history;
   never bypass these errors by moving a release tag. A duplicate heading protects reviewed
   notes from regeneration: use `--dry-run` before the first generation, or review a fresh
   preview in a disposable checkout with the target section absent. Do not delete reviewed
   notes merely to rerun the generator.

4. Run the local gates:

   ```sh
   npm ci --ignore-scripts
   npm run check
   npm run release:check
   npm run test:package
   ```

   `npm run release:check` requires a stable version, a matching tag, a lockfile whose name,
   version, engines and dependency sets match the manifest, public `publishConfig.access`, and
   a single nonempty `## [x.y.z]` changelog section for the current version.
   To extract notes locally without publishing, run
   `npm run release:check -- vX.Y.Z /path/to/release-notes.md` with the current package tag.

   Package smoke testing inspects the real archive allowlist, installs it offline in a
   disposable directory without lifecycle scripts, dev dependencies or host peers, checks the
   packed manifest, README links/images, that only the locked production tree installs and that
   no host packages are duplicated, then loads and registers `/btw` through the pinned Pi
   resource loader. It also checks the npm startup label and, through the per-repo hook in
   `scripts/test-package.config.mjs`, the noninteractive rejection boundary without a provider
   call. These are not
   live-provider or TUI tests. To retain and inspect the **same** tarball used by the test:

   ```sh
   release_dir="$(mktemp -d)"
   npm pack --pack-destination "$release_dir"
   tar -tzf "$release_dir/howarewoo-pi-btw-0.2.0.tgz"
   npm run test:package -- "$release_dir/howarewoo-pi-btw-0.2.0.tgz"
   ```

5. Submit the version/changelog changes as a human-reviewed release PR and merge it after CI.
   These instructions describe maintainer actions; local checks do not commit or publish.

CI runs all checks and the package smoke test on Node 22.19.0 and Node 24. It uses pinned Pi
1.6.0 development packages, not an implied matrix of all Pi versions. `prepublishOnly` runs
the local gates for a direct source-directory publish; verified-tarball publication deliberately
uses `--ignore-scripts` only after those gates.

## Tag and publish

From the exact merged release commit (replace the example version as needed):

```sh
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

**Do not push a tag as a test**: this workflow can publish. `release.yml` accepts tag pushes
and manual dispatch on an existing `v*` tag, not branch dispatch, and rejects forks by exact
repository identity. Its three GitHub-hosted jobs run in order:

1. **validation** has only `contents: read`, no OIDC permission or publishing environment.
   It checks main ancestry, tag/manifest/lockfile versions and changelog, installs dependencies
   with `npm ci --ignore-scripts`, runs the existing checks, packs once, computes SHA-512 and
   smoke-tests that exact tarball. It uploads package/metadata and notes as separate artifacts.
2. **publish** depends on validation and requires the protected `npm` environment approval.
   Only this job has `id-token: write`; it has `contents: read`, never `contents: write`.
   It selects the package artifact by validation's exact artifact ID from the current run.
   Before any registry request, the reviewed checked-out, dependency-free publish helper
   requires regular metadata/tarball files, checks the fixed package name, stable version,
   tag, commit and fixed tarball filename, and recomputes SHA-512 against validation's job
   output. A missing or mismatched download is fatal; download-action digest warnings are
   not the publication gate. It neither installs dependencies nor extracts/executes archive
   content, runs tests, or repacks. `npm publish --ignore-scripts` suppresses lifecycle scripts.
3. **github-release** depends on npm success. It has `contents: write` but no OIDC permission,
   downloads only the selected notes artifact, and creates the GitHub release without checking
   out or executing package code. An existing release remains unchanged.

Releases serialize; a later tag does not cancel an active publish. Artifact retention is seven
days. If artifacts expire, rerun validation and all downstream jobs on the same immutable tag
rather than substituting an artifact from another run. No executable helper comes from the
transferred artifact. Separation limits credential exposure during tests/builds; it does not
prove that a compromised validation job produced trustworthy package bytes. Review the release
commit and approval evidence before authorizing publication.

For local integrity-only diagnostics, `node scripts/publish-package.mjs <artifact-directory>
--verify-only` checks files against `RELEASE_TAG`, `RELEASE_COMMIT` and `RELEASE_INTEGRITY`
without registry access or publication. This is not an authentication test.

Verify both the npm version/integrity and OIDC provenance and the GitHub release before
announcing it. Test a clean Pi install, then `/btw`. No tag, registry publish, trusted-publisher
setting or fresh installed-package walkthrough is performed by local CI checks.

## Recover a partial or bad release

- **Failed before npm publication:** fix the configuration or external prerequisite, then rerun
  the workflow for the same tag. Do not move the tag to a changed commit.
- **npm published, GitHub release failed:** rerun the failed workflow, or dispatch **Release**
  on the same existing tag. It skips npm publication only when that version's integrity exactly
  matches the verified tarball. An existing GitHub release is left unchanged. A different integrity
  or a registry error stops the workflow; do not bypass the check. Changes to this workflow apply
  only to tags containing them; rerunning an older tag still uses its original workflow.
- **Published contents are wrong:** prepare a new patch (or appropriate breaking version), with
  clear changelog guidance. Deprecate the affected version with an explanatory npm message if
  needed; do not unpublish as the normal rollback strategy.
- **User rollback:** let side requests finish, explicitly install the last known-good version,
  then restart Pi. For example, `pi install npm:@howarewoo/pi-btw@0.1.2` if that is the last
  known-good release. Pinning code does not undo incompatible persisted data changes; follow
  release-specific migration instructions.

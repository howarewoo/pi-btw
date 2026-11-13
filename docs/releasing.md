# Release preparation and publication

`@howarewoo/pi-btw@0.1.0` is a **planned, unpublished** initial scoped release.
This change prepares local checks and GitHub Actions; it does not publish, create tags,
configure accounts, or install repository/environment/npm protections. Ordinary CI cannot
publish. There is no automatic GitHub release creation.

## Owner prerequisites (not configured by these files)

A repository owner and an npm package owner must separately authorize and complete setup:

1. Confirm the npm account owns or can publish in the `@howarewoo` scope, can create the
   public package `@howarewoo/pi-btw`, and meets npm's current account/2FA requirements.
   An unauthenticated `npm view` E404 does **not** reserve the name or prove account access.
   A local `npm whoami` E401 says nothing about GitHub OIDC; `npm whoami` cannot test trust.
2. Enable Actions on the **public** `howarewoo/pi-btw` repository. Create the GitHub
   environment **`npm` before any release tag push**, with required human approval by
   `howarewoo` (allow self-approval if this is the sole maintainer) and deployment refs
   restricted to release tags `v*`. Protect `main` with the CI checks and restrict release-tag
   creation/deletion to maintainers. Review these settings explicitly: `environment: npm`
   in YAML alone can create an **unprotected** environment and is not an approval rule.
3. Bootstrap the new package with the separately authorized manual first publish below.
   Package trusted-publisher settings require the package to exist first; do not assume
   the initial tag workflow can create a package or establish npm ownership.
4. After bootstrap, in **`@howarewoo/pi-btw` → Settings → Trusted publishing**, configure:

   | Field                | Exact value   |
   | -------------------- | ------------- |
   | Organization or user | `howarewoo`   |
   | Repository           | `pi-btw`      |
   | Workflow filename    | `release.yml` |
   | Environment name     | `npm`         |

   Allow **direct `npm publish`** if an allowed-actions selector is shown; stage-only
   permission is insufficient. This workflow does not use `npm stage`. It requires a
   GitHub-hosted runner, Node 24 and npm **>=11.5.1**. No `NPM_TOKEN`/`NODE_AUTH_TOKEN`
   secret or stored-token fallback is used. The publish helper refuses nonempty token
   variables and requires GitHub OIDC context.

5. Create trust near the next deliberate OIDC release: per current npm documentation,
   a new trust configuration must have its **first successful publish within two days**
   or it expires. An already-published/identical-version skip is not an OIDC publish.
   Confirm current rules in [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).
   Public-repository/public-package OIDC publishing generates provenance automatically;
   the manual bootstrap below does not establish that provenance. After successful OIDC
   publication, consider restricting traditional token publishing and revoking unused
   automation tokens. Do not claim trust is installed or working until the owner verifies
   settings and an intentionally authorized publication succeeds.

## Prepare and verify locally (no publication)

Use a reviewed release branch from current `main`. Keep Pi peers `*` as required by
Pi's package format; development SDK dependencies are pinned to **1.5.2**, the minimum
supported host and automated-test baseline. Users may update to newer Pi versions;
the development pins do not constrain the installed host. Later versions have not yet
been verified, and future breaking SDK changes may require an extension update.
The Node minimum is **22.19.0**.

For a later version, update manifest and lockfile with `npm version <version> --no-git-tag-version`.
Move Unreleased changes into a nonempty `## x.y.z - YYYY-MM-DD` changelog entry. Use stable
semantic versions only (`latest` channel); there is no prerelease policy. Review release
notes/date and the planned/unpublished wording before an authorized first publication.
Never move a tag or reuse a published version.

```sh
npm ci --ignore-scripts
npm run check
npm run release:check
npm run test:package
```

CI runs those gates on Node 22.19.0 and Node 24. Release metadata checks allow pending
Unreleased notes and require matching package/lockfile versions and nonempty versioned notes.
Unreleased changes describe future work and are not part of the version being validated.
Package smoke checks inspect the real archive allowlist, install it offline without scripts,
dev dependencies or automatic peers, check README links/images and no duplicated host packages,
and load/register `/btw` through the actual pinned Pi resource loader. It also exercises the
noninteractive rejection boundary without a provider call. These are not live-provider/TUI tests.
There are no `prepare`/`prepack` development checks that would break consumer installs.
`prepublishOnly` runs local gates for a direct source-directory publish; verified-tarball
publication deliberately uses `--ignore-scripts` only after those gates.

To retain and inspect the **same** tarball used by the consumer test:

```sh
release_dir="$(mktemp -d)"
npm pack --pack-destination "$release_dir"
tar -tzf "$release_dir/howarewoo-pi-btw-0.1.0.tgz"
npm run test:package -- "$release_dir/howarewoo-pi-btw-0.1.0.tgz"
```

Review the source/manifest, archive and evidence, and merge the release preparation only
after review and passing CI. No local command above commits, pushes or publishes.

## First package bootstrap — only with separate owner authorization

This is a manual owner action, **not part of the current preparation**. After setup and
review, use an npm account with scope rights and the required authentication/2FA. From the
exact clean merged release commit, run all local gates above and retain/test its tarball.
Only when explicitly authorized, authenticate interactively and publish that checked file:

```sh
npm login
npm publish "$release_dir/howarewoo-pi-btw-0.1.0.tgz" --access public --ignore-scripts
npm view @howarewoo/pi-btw@0.1.0 version dist.integrity
```

Compare registry SHA-512 integrity with the retained bytes before announcing availability.
Keep the tarball until verified. Then configure package trust as above. A workflow rerun
for already-published identical bytes can skip publication, but cannot validate OIDC or
satisfy the first-successful-publish trust window; plan the next genuinely new release.

## Later authorized tag releases

Only after the exact release commit is merged to `main`, CI is green, and all owner gates
are verified, a maintainer may deliberately create/push its matching immutable `vX.Y.Z`
tag. **Do not push a tag as a test**: this workflow is publication-capable. It is tag-push
only (no manual/branch dispatch), serializes releases, and rejects forks by exact repository
identity. Its two jobs are:

1. **validation** (`contents: read`, no OIDC/environment) checks main ancestry and tag/version,
   installs with `npm ci --ignore-scripts`, runs checks, packs once, computes SHA-512, and
   smoke-tests that exact tarball. It uploads only `release.tgz` plus identity/digest metadata.
2. **publish**, after validation and protected environment `npm` approval, has `contents: read`
   and **only here** `id-token: write`. It downloads validation's exact artifact ID from the
   current run, not a name from another run. The dependency-free helper is checked out from
   the release commit, never taken from the artifact. Before any registry request, it checks
   regular metadata/tarball files, fixed package name/filename, stable version, tag, commit,
   and SHA-512 against the independent validation output. Download-action digest warnings
   alone are not the publication gate. It installs no dependencies, runs no archive code,
   does not repack, and publishes that same file with `npm publish --access public --ignore-scripts`.

Existing npm versions are accepted only if their registry integrity exactly matches the checked
bytes; other registry errors or mismatches fail closed. The job does not create a GitHub release
or use `contents: write`. Artifact retention is seven days. If artifacts expire, rerun all jobs
on the same immutable tag, never substitute another run's artifact. This separation limits
credentials during checks but does not make a compromised validation job trustworthy: review
the release commit and evidence before approving the environment.

For local integrity-only diagnostics, `node scripts/publish-package.mjs <artifact-directory>
--verify-only` checks files against `RELEASE_TAG`, `RELEASE_COMMIT` and `RELEASE_INTEGRITY` without
registry access or publication. This is not an authentication test.

After an authorized release, verify npm version/integrity and OIDC provenance, then try a clean
Pi install and `/btw`. If publishing fails before publication, correct external prerequisites
or rerun the same immutable tag. If bytes were published incorrectly, prepare a new patch and
migration/deprecation guidance; never overwrite/move a tag or unpublish as the normal rollback.
Users can explicitly install a known-good published version and restart Pi, but pinning code
cannot undo incompatible persisted data changes. No bootstrap, tag, publish, trust setup or
fresh live-provider walkthrough is performed by these preparation checks.

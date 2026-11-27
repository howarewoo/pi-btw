# Local development

This page is for contributors working from a source checkout: the checks, the tests, the package
smoke test and regenerating the README illustrations. Maintainers publishing a release should
also read the [release guide](releases.md).

From a source checkout:

```sh
git clone https://github.com/howarewoo/pi-btw.git
cd pi-btw
npm ci --ignore-scripts
npm run lint
npm run format:check
npm run typecheck
npm test
npm pack --dry-run
npm run test:package
```

`npm run check` runs lint, formatting, typechecking and tests; CI and prepublish use the same
checks. Tests run with Node's native TypeScript support (`node --test`); no build step or
TypeScript loader is required. Run `pi install .` to install the checkout, or `pi -e ./index.ts`
for a one-invocation trial without changing package settings. The package loads only the root
`index.ts` entry point; source modules, README, these docs pages and their images, changelog, and
license are included in its install contents.

`npm test` uses the real pinned Pi 1.6.0 SDK with a deterministic provider fixture. It checks
tool declarations and execution/rejection, context isolation, concurrency, stop, restore/branch
fencing, commands, copy filtering, Unicode/narrow/wide hub rendering, release metadata,
changelog generation and publication safeguards. `npm run typecheck` checks source and fixtures.
Oxlint checks correctness rules; warnings fail the lint command. Run `npm run lint:fix` for safe
lint fixes and `npm run format` to apply Oxfmt formatting. Formatting skips the generated
lockfile.

`npm run release:check` validates release metadata; `npm run test:package` packs, inspects and
installs the actual tarball in a disposable consumer (cache-first, isolated npm config), then
checks pinned Pi loading and the noninteractive command boundary. These do not publish or verify npm account access.
`npm pack --dry-run` only lists install contents. Maintainers: see the
[release guide](releases.md).

A small offline model fixture in `test/interactive-fixture.ts` is available for isolated
manual TUI checks; it is not installed with the package. Automated SDK tests and an offline
TUI smoke do not establish live-provider compatibility or every terminal/clipboard backend.
Pi 1.5.2 is the minimum supported version and Pi 1.6.0 the tested host, not an exact-version
requirement. Newer Pi versions are allowed; later versions have not yet been verified, and
future breaking SDK changes may require an extension update.

## Regenerate README illustrations

From a checkout after `npm ci`, run `npm run render:readme` to regenerate
`docs/images/btw-hub.svg` and `docs/images/btw-compact.svg`. The generator uses the
production hub and native Pi transcript components with synthetic `Threads` and
in-memory `SessionManager` data only. It loads no parent session and makes no provider
requests. It uses the real theme and live neutral panel paint without illustration-only
theme overrides. The ANSI-to-SVG converter is adapted from pi-extended-subagents (MIT).
The generator and tests are not installed with the package; the README images are.

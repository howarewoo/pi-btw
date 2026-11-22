# Contributions

- Do not edit `CHANGELOG.md` in ordinary PRs, including implementation/documentation PRs.
  Generate and review notes only in deliberate release-preparation PRs; preserve historical entries.
- Use Conventional Commit PR titles: `type(optional-scope)!: description`. Allowed types:
  `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `style`.
  Examples: `feat(hub): add collapsible output`, `fix: correct startup label`,
  `feat!: change writer concurrency`.
- Explain user-facing changes, compatibility and migration in the PR description. Mark breaking
  changes with `!` and include `BREAKING CHANGE:` guidance in the commit body when merging.
  Maintainers must confirm the final squash commit title and body; a valid PR title alone does
  not guarantee a conventional mainline commit. See [the release guide](docs/releases.md).

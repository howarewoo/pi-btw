# Installation and updates

This page covers host requirements, install sources, moving from the older unscoped extension,
updates, pinned versions and rollback. For a first run, start with the
[README quick start](../README.md#quick-start).

## Requirements and install sources

Requires **Node 22.19+**, **Pi 1.5.2 or newer** and a working model/provider login.
Tested host: Pi 1.6.0; newer versions are allowed, not guaranteed compatible. Review
extension source before installing: extensions themselves run with Pi's operating-system
permissions.

Install from npm:

```sh
pi install npm:@howarewoo/pi-btw
```

Alternatively, install from Git with `pi install git:github.com/howarewoo/pi-btw`.
Use only one source: when switching between npm, Git or a local checkout, remove the
previously registered source first so Pi does not load the extension twice.

Restart Pi, or run `/reload` in an existing idle session after installing.

## Moving from the older unscoped pi-btw extension

This is a standalone replacement, not an upgrade of the unscoped npm package. Before
installing, use `pi list` and `pi config` to identify the old package or extension.
Disable/remove that old extension yourself, then install this package and reload. Do not
leave both enabled: they register the same `/btw` command and Pi may suffix the names.
There are no old aliases, mode commands, model overrides, or old-history migration.
Old saved session data is not deleted or imported.

## Updates and rollback

Let side requests finish before updating, then restart Pi or run `/reload`. Reload and
shutdown stop active side requests; unfinished turns restore as interrupted and are not
replayed. There is no extension-owned auto-updater.

```sh
# Update an unpinned npm installation
pi update npm:@howarewoo/pi-btw

# Or update all installed extension packages
pi update --extensions
```

Plain `pi update` updates Pi itself, not installed extension packages. For a Git installation,
use `pi update git:github.com/howarewoo/pi-btw`, matching the source you registered.
An unpinned Git source tracks the repository's default branch, including unreleased commits.

For a reproducible npm installation or rollback, select an exact published version. Replace
`<version>` with one from the
[npm version list](https://www.npmjs.com/package/@howarewoo/pi-btw?activeTab=versions):

```sh
pi install npm:@howarewoo/pi-btw@<version>
```

For Git, select a published tag: `pi install git:github.com/howarewoo/pi-btw@v<version>`.
Exact npm versions and Git tags stay pinned; updating does not advance them to the next release.
Install a different version explicitly to change the pin.

[CHANGELOG.md](../CHANGELOG.md) lists user-facing changes and migrations. Pi shows new package
changelog entries on the next fresh launch after a version increase. See the
[maintainer release guide](releases.md) for publishing and recovery.

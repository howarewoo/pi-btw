# @howarewoo/pi-btw

[![npm version](https://img.shields.io/npm/v/%40howarewoo%2Fpi-btw)](https://www.npmjs.com/package/@howarewoo/pi-btw)
[![npm downloads](https://img.shields.io/npm/dm/%40howarewoo%2Fpi-btw)](https://www.npmjs.com/package/@howarewoo/pi-btw)

A [Pi coding agent](https://pi.dev) extension for asking read-only side questions with `/btw` while the main agent keeps working, each in its own thread with saved history.

![Synthetic native-renderer illustration of the wide BTW hub: four independent threads with green idle, active running, warning hollow interrupted and muted hollow cancelled circles on a neutral gray panel beside a read-only conversation, read tool output, reply and follow-up draft.](docs/images/btw-hub.svg)

_Two-panel BTW hub with colored status circles and a neutral gray panel, rendered by
the production UI with synthetic in-memory data. Not a terminal screenshot or
live-provider evidence._

## Why use it

Use it to look something up without interrupting the main agent or adding to its context:

- Every `/btw <prompt>` starts a new thread. Threads run at the same time, and closing the hub does not stop them.
- A thread starts from a one-time snapshot of the main conversation and stays out of the main agent's future model context.
- Threads can call only `read`, `grep`, `find` and `ls`, enforced by the child session's tool allowlist rather than its prompt. See [the read-only boundary](docs/read-only-boundary.md).
- Each turn uses the main session's current model and thinking level. A provider or login failure shows on the thread instead of switching to another model.
- Threads are saved in the parent session file. A request still running at reload comes back as interrupted and is never resent on its own. See [persistence](docs/persistence.md).
- The [hub](docs/hub.md) shows each thread with Pi's own chat and tool renderers, and has keys to switch threads, stop one request or copy a reply.

Side threads cannot edit files, run shell commands, or call subagents or MCP tools. They are not sandboxed either: the four tools can read any local path Pi can, including outside the project, so don't point them at secrets. For side work that changes files, use the main session or a subagent extension such as [pi-subagents](https://github.com/howarewoo/pi-subagents).

## Project status

Actively maintained, with releases below 1.0 (the npm badge shows the current version). It needs Node 22.19 or newer and Pi 1.5.2 or newer, and is tested with Pi 1.6.0. Newer Pi versions are allowed but not yet verified. Before 1.0, a minor release can include breaking changes, so read the [update notes](docs/installation.md#updates-and-rollback) before upgrading.

## Install

```sh
pi install npm:@howarewoo/pi-btw
```

To install from Git instead, run `pi install git:github.com/howarewoo/pi-btw`. Register only one source, or Pi loads the extension twice. Extensions run with Pi's operating-system permissions, so review the source before installing.

Restart Pi, or run `/reload` in an idle session. Then run `/btw` with no prompt: the empty hub opens without a model request, which shows the extension is loaded. Press Esc to close it. See [installation and updates](docs/installation.md) for pinned versions, rollback and replacing the older unscoped `pi-btw` extension.

## Quick start

`/btw` needs interactive Pi and a model: choose one with Pi's `/login` and `/model` commands. Side threads send requests to that provider, so they can cost money.

In a project containing `README.md` and `package.json`:

1. Start a side question:

   ```text
   /btw Read README.md and summarize this project's purpose in three bullets.
   ```

2. Press **Esc** to close the hub, then start another question:

   ```text
   /btw Read package.json and explain the main npm scripts.
   ```

3. Use **Up / Down** to select either thread. After its request finishes, send a
   follow-up in that thread's composer.

The hub now lists two independent threads, and the main conversation has neither of them in its context. Closing the hub does not cancel requests. Every `/btw <prompt>` creates a new thread; to continue a conversation, write in the selected thread's composer. Bare `/btw` reopens the hub.

```text
/btw <prompt>   # start a new thread and open the hub
/btw            # reopen the hub without a model request
```

In the hub, Ctrl+S stops only the selected thread's request, and Ctrl+Y copies its latest reply. The [hub guide](docs/hub.md#keys) lists every key.

## Documentation

| Topic                                                                        | What it covers                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Using the hub](docs/hub.md)                                                 | Commands, layouts, keys, scrolling, stopping and copying                 |
| [Context and read-only boundary](docs/read-only-boundary.md)                 | The context snapshot, model inheritance and the four allowed tools       |
| [Persistence and recovery](docs/persistence.md)                              | Where threads are saved, restore after reload, branches and long threads |
| [Installation and updates](docs/installation.md)                             | Host support, install sources, updates, rollback and the old extension   |
| [Local development](docs/development.md)                                     | Checks, tests, the package smoke test and README illustrations           |
| [Releases](docs/releases.md) and [changelog](CHANGELOG.md)                   | Versioning, compatibility policy, publishing and user-facing changes     |
| [Security policy](https://github.com/howarewoo/pi-btw/blob/main/SECURITY.md) | Vulnerability reporting and trust boundaries                             |

## License

MIT. Includes adapted SDK isolation patterns from Dan Bachelder's pi-btw and native
transcript rendering from Adam Woo's pi-extended-subagents. See [LICENSE](LICENSE).

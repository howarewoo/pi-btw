# Context and read-only boundary

This page covers what a side thread sees from the main conversation, which model it uses and
which tools it can call.

## Context snapshot

At creation, the extension captures the **current parent's branch model context once**
(with compaction applied) and its effective system/project instructions. That snapshot
is persisted with the thread, kept separate from visible/copyable side messages, and
never refreshed from later parent conversation turns. Later follow-ups use only that
snapshot and their own thread history. Child reads can still see subsequent local file changes.

## Model

Each turn inherits the parent's current model and thinking level. The hub displays the
selected/effective model; it never silently substitutes a different model when authentication
fails. Provider or credential failures are visible on that thread. There are no override controls.

## Tools

Each child is a real SDK session with **only `read`, `grep`, `find`, and `ls` registered**.
An explicit tool allowlist and a resource loader with no extensions, skills, templates,
or arbitrary resource discovery enforce this structurally, not just through a prompt.
Inherited historical tool calls do not grant tools. There is no bash, edit, write,
subagent, MCP, codemode, or SSH support in children.

This is a capability restriction, **not a filesystem sandbox**: the four tools can read
local paths accessible to Pi, including paths outside the working directory. The extension
itself and the model provider remain trusted code. Do not ask it to read secrets.

See the [security policy](https://github.com/howarewoo/pi-btw/blob/main/SECURITY.md) for
vulnerability reporting and trust boundaries.

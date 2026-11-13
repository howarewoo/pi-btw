# Changelog

## Unreleased

## 0.1.0 - 2026-11-12

_Planned initial release; not yet published._

- Clarify Pi 1.5.2 as the minimum supported version rather than an exact-version requirement; allow newer hosts while distinguishing the tested baseline from unverified later versions.

- Add a fixed conversation-width separator below the selected header, without crossing the wide roster or changing the full-width footer divider.
- Support native mouse-wheel transcript scrolling in Pi fullscreen mode; scrolling up pauses live follow, returning to the bottom resumes it, and wheel events elsewhere in the overlay do not scroll the parent chat. Retain PageUp/PageDown and Ctrl+End for keyboard scrolling, including regular mode.

- Label the footer copy shortcuts explicitly as “Copy reply” and “Copy conversation” without changing their bindings or behavior.

- Scope the selected conversation’s status/title/model header to the thread column in wide hubs, with the roster starting directly below the outer frame; retain the full-width compact header and footer divider.

- Reserve plain Up/Down for older/newer thread navigation from either pane, with Pi selection-key remappings and Ctrl+Up/Down aliases; keep per-thread drafts, reading positions, and focus.
- Append new threads at the bottom of the oldest-first roster and restore SDK checkpoints in creation order, without moving older threads on follow-up updates or changing saved data.

- Match live hub panels to the subagents overlay’s neutral gray at theme lightness, restoring the panel background across ANSI resets while preserving native transcript blocks.
- Replace roster/header status words with colored circles and a separate selection marker; document the compact legend without adding viewport rows.
- Remove the illustration-only background override and regenerate wide/compact synthetic README illustrations from the actual live theme paint.

- Prepare public scoped npm metadata, isolated packed-package checks, and tag-triggered trusted publishing; owner account/bootstrap and trust setup remain prerequisites.
- Remove opaque shortened thread IDs from hub roster labels and the selected conversation header; show titles/status/model instead, retaining compact thread-number navigation.
- Extend the hub composer's bottom boundary across both columns to separate the footer, without adding a row; compact hubs use the same full-width divider.
- Add wide and compact README illustrations from the production BTW hub/native transcript renderer with synthetic offline data, plus `npm run render:readme` for regeneration.
- Include README SVG images in package contents; no runtime behavior changes.
- Use a neutral charcoal background for synthetic README hub panels while retaining native user/tool blocks and colored text accents.
- Introduce standalone `@howarewoo/pi-btw` for Pi 1.5.2.
- Make every `/btw <prompt>` a new independent, concurrent read-only thread; bare `/btw` only opens the hub.
- Add a themed responsive hub with native transcripts, multiline follow-ups, retained drafts/reading positions, selected Stop, and separate reply/conversation copy.
- Freeze inherited parent context at creation; enforce the four-tool SDK allowlist without child extensions or resource discovery.
- Persist hidden versioned SDK transcript checkpoints on the current parent branch, restore unfinished turns as interrupted, and fence stale async work during lifecycle changes.

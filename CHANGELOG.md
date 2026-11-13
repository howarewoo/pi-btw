# Changelog

## Unreleased

- Remove opaque shortened thread IDs from hub roster labels and the selected conversation header; show titles/status/model instead, retaining compact thread-number navigation.
- Extend the hub composer's bottom boundary across both columns to separate the footer, without adding a row; compact hubs use the same full-width divider.
- Add wide and compact README illustrations from the production BTW hub/native transcript renderer with synthetic offline data, plus `npm run render:readme` for regeneration.
- Include README SVG images in package contents; no runtime behavior changes.
- Use a neutral charcoal background for synthetic README hub panels while retaining native user/tool blocks and colored text accents.

## 0.1.0 - 2026-11-12

- Introduce standalone `@howarewoo/pi-btw` for Pi 1.5.2.
- Make every `/btw <prompt>` a new independent, concurrent read-only thread; bare `/btw` only opens the hub.
- Add a themed responsive hub with native transcripts, multiline follow-ups, retained drafts/reading positions, selected Stop, and separate reply/conversation copy.
- Freeze inherited parent context at creation; enforce the four-tool SDK allowlist without child extensions or resource discovery.
- Persist hidden versioned SDK transcript checkpoints on the current parent branch, restore unfinished turns as interrupted, and fence stale async work during lifecycle changes.

# Changelog

## 0.1.0 - 2026-11-12

- Introduce standalone `@howarewoo/pi-btw` for Pi 1.5.2.
- Make every `/btw <prompt>` a new independent, concurrent read-only thread; bare `/btw` only opens the hub.
- Add a themed responsive hub with native transcripts, multiline follow-ups, retained drafts/reading positions, selected Stop, and separate reply/conversation copy.
- Freeze inherited parent context at creation; enforce the four-tool SDK allowlist without child extensions or resource discovery.
- Persist hidden versioned SDK transcript checkpoints on the current parent branch, restore unfinished turns as interrupted, and fence stale async work during lifecycle changes.

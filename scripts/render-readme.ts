// Regenerate: npm run render:readme
// ANSI-to-SVG converter adapted from pi-extended-subagents (Adam Woo, MIT; see LICENSE).
// Only production UI + in-memory synthetic transcripts. No session discovery or provider calls.
import { mkdirSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { initTheme, SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ProcessTerminal,
  TuiMainScreen,
  getKeybindings,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { createHub } from "../src/hub.ts";
import { Threads, type Thread } from "../src/runtime.ts";

process.env.COLORTERM = "truecolor";
initTheme("dark", false);
const cwd = "/synthetic/project";
const threads = new Threads(() => {});
// Oldest to newest, as if each synthetic thread had been appended on creation.
const examples: { id: string; title: string; status: Thread["status"] }[] = [
  { id: "b2222222-2222-4222-8222-222222222222", title: "Find retry limits", status: "running" },
  { id: "c3333333-3333-4333-8333-333333333333", title: "Review API notes", status: "interrupted" },
  { id: "d4444444-4444-4444-8444-444444444444", title: "Trace config lookup", status: "cancelled" },
  { id: "a1111111-1111-4111-8111-111111111111", title: "Read cache policy", status: "idle" },
];
for (const example of examples) {
  threads.list.push({
    ...example,
    cwd,
    systemPrompt: "Synthetic read-only illustration.",
    inheritedIds: [],
    manager: SessionManager.inMemory(cwd),
    model: "synthetic/offline",
    stopped: false,
    draft: "",
    offset: 0,
    following: true,
  });
}
// The most recently appended thread is selected, at the bottom of the roster.
const selected = threads.list.at(-1)!;
threads.selected = selected.id;
selected.draft = "Does a cache miss change that?";
selected.manager.appendMessage({
  role: "user",
  timestamp: 1,
  content: "What is the cache TTL? Read only, please.",
});
selected.manager.appendMessage(
  fauxAssistantMessage(
    fauxToolCall("read", { path: "cache-policy.txt" }, { id: "synthetic-read" }),
    { stopReason: "toolUse", timestamp: 2 },
  ),
);
selected.manager.appendMessage({
  role: "toolResult",
  toolCallId: "synthetic-read",
  toolName: "read",
  timestamp: 3,
  content: [
    {
      type: "text",
      text: "# Synthetic cache policy\nTTL: 60 seconds\nCache key: <route> & <locale>",
    },
  ],
  isError: false,
});
selected.manager.appendMessage(
  fauxAssistantMessage(
    "The TTL is **60 seconds**. Keys combine route & locale. No files changed.",
    { timestamp: 4 },
  ),
);

// Use the real terminal renderer without starting input/output or an agent session.
const terminal = new ProcessTerminal();
const tui = new TuiMainScreen(terminal);
tui.requestRender = () => {};
// The hub observes only cwd/theme from ExtensionContext; no parent context is loaded.
const ctx = { cwd, ui: { theme } } as ExtensionContext;
mkdirSync(new URL("../docs/images/", import.meta.url), { recursive: true });
for (const [name, columns, rows] of [
  ["hub", 128, 30],
  ["compact", 70, 33],
] as const) {
  Object.defineProperty(terminal, "rows", { value: rows, configurable: true });
  Object.defineProperty(terminal, "columns", { value: columns, configurable: true });
  const hub = createHub(threads, ctx, tui, getKeybindings(), () => {});
  const lines = hub.render(columns);
  hub.dispose();
  const title = `BTW ${name === "hub" ? "two-panel hub" : "compact conversation"} — synthetic native-renderer illustration`;
  const description =
    "Production createHub and native Pi transcript output with a live neutral panel background, colored status circles, synthetic in-memory threads, read tool output, reply and follow-up draft. Not a terminal screenshot or live-provider evidence.";
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const width = 40 + columns * 8.4;
  const height = 48 + lines.length * 22 + 36;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${escape(title)}</title>`,
    `<desc id="desc">${escape(description)}</desc>`,
    '<rect width="100%" height="100%" rx="8" fill="#181818"/>',
    `<text x="20" y="28" fill="#aaaaaa" font-family="Menlo, monospace" font-size="12">ILLUSTRATION · BTW ${name} · synthetic native output</text>`,
  ];
  for (const [row, line] of lines.entries()) {
    let column = 0,
      fg = "#dddddd",
      bg = "",
      bold = false;
    // Native renderer colors are SGR escape sequences, not user-supplied text.
    for (const part of line
      // Pi editor cursor markers and terminal string protocols are not visible text.
      // oxlint-disable-next-line no-control-regex -- Strip terminal string protocols.
      .replace(/\x1b[\]P_^X][\s\S]*?(?:\x07|\x1b\\)/g, "")
      // oxlint-disable-next-line no-control-regex -- Parse native ANSI colors.
      .split(/(\x1b\[[0-9;]*m)/)) {
      if (part.startsWith("\x1b[")) {
        const codes = part.slice(2, -1).split(";").map(Number);
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i];
          if (code === 0) {
            fg = "#dddddd";
            bg = "";
            bold = false;
          } else if (code === 1) bold = true;
          else if (code === 22) bold = false;
          else if (code === 39) fg = "#dddddd";
          else if (code === 49) bg = "";
          else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
            const color = `rgb(${codes.slice(i + 2, i + 5).join(",")})`;
            if (code === 38) fg = color;
            else bg = color;
            i += 4;
          }
        }
        continue;
      }
      const text = stripVTControlCharacters(part)
        // XML 1.0 forbids these even when escaped; preserve only printable text.
        // oxlint-disable-next-line no-control-regex -- Remove characters forbidden in XML.
        .replace(/[\x00-\x1f\x7f-\x9f\ud800-\udfff\ufffe\uffff]/gu, "");
      const columns = visibleWidth(text);
      if (!columns) continue;
      const x = 20 + column * 8.4,
        y = 48 + row * 22,
        length = columns * 8.4;
      if (bg) svg.push(`<rect x="${x}" y="${y}" width="${length}" height="22" fill="${bg}"/>`);
      svg.push(
        `<text x="${x}" y="${y + 16}" xml:space="preserve" fill="${fg}" font-family="Menlo, monospace" font-size="14"${bold ? ' font-weight="bold"' : ""} textLength="${length}" lengthAdjust="spacingAndGlyphs">${escape(text)}</text>`,
      );
      column += columns;
    }
  }
  svg.push("</svg>\n");
  writeFileSync(new URL(`../docs/images/btw-${name}.svg`, import.meta.url), svg.join(""));
}

import { copyToClipboard, getSelectListTheme, type ExtensionContext, type ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  Editor, ScrollView, colorToOklch, oklchColor, matchesKey, truncateToWidth, visibleWidth,
  type Component, type Focusable, type KeybindingsManager, type TUI,
} from "@earendil-works/pi-tui";
import { Threads, busy, messages, type Thread, type Status } from "./runtime.ts";
import { createNativeThread, safe } from "./transcript.ts";
import { copyText } from "./copy.ts";

const statusIndicators = {
  starting: { glyph: "◉", color: "accent" },
  running: { glyph: "◉", color: "accent" },
  idle: { glyph: "●", color: "success" },
  failed: { glyph: "●", color: "error" },
  cancelled: { glyph: "○", color: "muted" },
  interrupted: { glyph: "○", color: "warning" },
} satisfies Record<Status, { glyph: string; color: ThemeColor }>;

export function layout(width: number, rows: number) {
  const height = Math.max(1, Math.floor(rows * 0.9));
  const inner = Math.max(1, width - 4);
  const roster = width >= 76 ? Math.min(32, Math.floor(inner / 3)) : 0;
  return { height, inner, roster, transcript: Math.max(1, inner - (roster ? roster + 3 : 0)) };
}

/** Closing this observer does not stop any request. Drafts/scroll state live on each thread. */
export function createHub(
  threads: Threads, ctx: ExtensionContext, tui: TUI,
  keys: KeybindingsManager, done: () => void,
): Component & Focusable & { dispose(): void } {
  let focused = false;
  let target: "composer" | "roster" = "composer";
  let notice = "";
  let closed = false;
  let viewport = 1;
  let controlsVisible = false;
  let threadBounds: { x: number; y: number; width: number; height: number; id: string; rows: number; columns: number } | undefined;
  const native = createNativeThread({ tui, cwd: ctx.cwd });
  const views = new Map<string, { editor: Editor; scroll: ScrollView }>();
  const refresh = () => { if (!closed) tui.requestRender(); };
  const unsubscribe = threads.subscribe(refresh);
  function view(thread: Thread) {
    let current = views.get(thread.id);
    if (!current) {
      const editor = new Editor(tui, {
        borderColor: (text) => ctx.ui.theme.fg("border", text),
        selectList: getSelectListTheme(),
      });
      editor.disableSubmit = true;
      editor.setText(thread.draft);
      editor.onChange = () => { thread.draft = editor.getExpandedText(); refresh(); };
      const scroll = new ScrollView({ render: () => [], invalidate() {} }, { follow: "end", scrollbar: "hidden" });
      current = { editor, scroll };
      views.set(thread.id, current);
    }
    return current;
  }
  const switchBy = (delta: number) => {
    const index = threads.list.findIndex((thread) => thread.id === threads.selected);
    threads.selected = threads.list[Math.max(0, Math.min(threads.list.length - 1, index + delta))]?.id;
    notice = "";
    refresh();
  };
  const scrollBy = (delta: number) => {
    const thread = threads.current();
    if (!thread) return;
    const scroll = view(thread).scroll;
    scroll.scrollBy(delta);
    thread.offset = scroll.scrollTop;
    thread.following = scroll.isFollowingEnd;
    refresh();
  };
  async function copy(whole: boolean) {
    const thread = threads.current();
    if (!thread) return;
    const text = copyText(thread, whole);
    if (!text.trim()) { notice = "Nothing to copy"; refresh(); return; }
    const status = thread.status;
    try {
      await copyToClipboard(text);
      notice = `Copied ${whole ? "conversation" : "latest reply"} · ${status}${busy(thread) ? " (partial)" : ""}`;
    } catch (error) { notice = `Copy failed: ${safe(String(error))}`; }
    refresh();
  }
  return {
    get focused() { return focused; },
    set focused(value) {
      focused = value;
      for (const [id, item] of views) item.editor.focused = value && target === "composer" && id === threads.selected;
    },
    render(width) {
      threadBounds = undefined;
      const size = layout(width, tui.terminal.rows);
      const { height, inner, roster, transcript: rightWidth } = size;
      controlsVisible = width >= 16 && height >= 16;
      const theme = ctx.ui.theme;
      const fit = (text: string, columns: number) => {
        const clipped = truncateToWidth(text, Math.max(0, columns));
        return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped)));
      };
      const panelBg = oklchColor(colorToOklch(theme.colors.customMessageBg).l, 0, 0);
      const paint = (text: string) => {
        const clipped = truncateToWidth(text, width);
        const padded = clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
        const restoreBg = theme.style("", { bg: panelBg }).replace(/\x1b\[49m$/, "");
        return padded
          .split("\x1b[0m")
          .map((part) => theme.style(part.replaceAll("\x1b[49m", restoreBg), { bg: panelBg }))
          .join("\x1b[0m");
      };
      const indicator = (status: Status) => {
        const { glyph, color } = statusIndicators[status];
        return theme.fg(color, glyph);
      };
      if (width < 4 || height < 3) return [paint("BTW · Esc")];
      const row = (text: string) => paint(theme.fg("border", "│ ") + fit(text, inner) + theme.fg("border", " │"));
      const frame = (left: string, title: string, right: string) => paint(theme.fg("border", left) +
        theme.fg("accent", truncateToWidth(title, width - 2)) +
        theme.fg("border", "─".repeat(Math.max(0, width - 2 - visibleWidth(truncateToWidth(title, width - 2)))) + right));
      const thread = threads.current();
      const lines = [frame("╭", ` BTW · ${threads.list.length} threads `, "╮")];
      if (!thread) {
        lines.push(row("No side conversations yet."), row("Use /btw <prompt> to start a fresh thread."),
          row("/btw opens this hub without a model request."));
      } else {
        const current = view(thread);
        for (const [id, item] of views) item.editor.focused = focused && target === "composer" && id === thread.id && controlsVisible;
        const header = `${indicator(thread.status)} ${safe(`${thread.title.replace(/\s+/g, " ")} · ${thread.model}`)}`;
        const paneRow = (text: string, item?: Thread) => {
          if (!roster) return row(text);
          const left = item ? `${theme.fg(item === thread ? "accent" : "muted", item === thread ? "›" : " ")} ${indicator(item.status)} ${theme.fg(item === thread ? "accent" : "muted", safe(item.title.replace(/\s+/g, " ")))}` : "";
          return row(fit(left, roster) + theme.fg("border", " │ ") + fit(text, rightWidth));
        };
        const separator = theme.fg("border", "─".repeat(rightWidth));
        if (!roster) lines.push(row(header), row(separator), row(safe(`${threads.list.indexOf(thread) + 1}/${threads.list.length} ${thread.title.replace(/\s+/g, " ")}`)));
        if (controlsVisible) {
          const composer = current.editor.render(rightWidth);
          const head = lines.length + (roster ? 2 : 0);
          const footer = 5;
          viewport = Math.max(1, height - head - footer - composer.length);
          threadBounds = { x: 2 + (roster ? roster + 3 : 0), y: head, width: rightWidth,
            height: viewport, id: thread.id, rows: tui.terminal.rows, columns: tui.terminal.columns };
          const content = native.render(thread.id, messages(thread), thread.partial, thread.live, rightWidth);
          const scroll = current.scroll;
          if (thread.following) scroll.scrollToEnd();
          scroll.updateLayout(content.length, viewport, refresh);
          if (!thread.following) scroll.scrollTo(thread.offset, { disableFollow: true });
          thread.offset = scroll.scrollTop;
          const transcript = content.slice(scroll.scrollTop, scroll.scrollTop + viewport);
          const right = [...(roster ? [header, separator] : []), ...Array.from({ length: viewport }, (_, index) => transcript[index] ?? ""),
            theme.fg("muted", thread.following ? "Follow-up · LIVE" : "Reading · Ctrl+End returns to live"), ...composer];
          const selectedIndex = threads.list.indexOf(thread);
          const rosterStart = Math.max(0, selectedIndex - Math.floor(right.length / 2));
          right.forEach((text, index) => {
            // Extend the editor's bottom border (including its scroll indicator)
            // across the roster, replacing its row rather than adding height.
            if (index === right.length - 1) {
              const left = roster ? `├${"─".repeat(roster + 2)}┴─` : "├─";
              lines.push(paint(theme.fg("border", left) + text + theme.fg("border", "─┤")));
              return;
            }
            lines.push(paneRow(text, threads.list[rosterStart + index]));
          });
        } else {
          if (roster) lines.push(paneRow(header, thread), paneRow(separator));
          lines.push(row("Resize for transcript and composer. Esc closes."));
        }
        lines.push(row(theme.fg(thread.error ? "error" : "muted", safe(notice || thread.error || `Focus: ${target} · local read-only tools`))));
        lines.push(row(theme.fg("dim", "Tab focus · ↑↓ threads · Ctrl+↑↓ threads · PgUp/PgDn read")));
        lines.push(row(theme.fg("dim", "Enter send · Shift+Enter newline · Ctrl+S Stop · Ctrl+Y Copy reply · Alt+Y Copy conversation · Esc close")));
      }
      while (lines.length < height - 1) lines.push(row(""));
      return [...lines.slice(0, height - 1), frame("╰", "", "╯")];
    },
    handleInput(data) {
      if (keys.matches(data, "tui.select.cancel")) { done(); return; }
      // Reserve arrows before either pane (especially Editor cursor/history) sees them.
      if (matchesKey(data, "up") || matchesKey(data, "ctrl+up")) { switchBy(-1); return; }
      if (matchesKey(data, "down") || matchesKey(data, "ctrl+down")) { switchBy(1); return; }
      if (keys.matches(data, "tui.select.up")) { switchBy(-1); return; }
      if (keys.matches(data, "tui.select.down")) { switchBy(1); return; }
      if (matchesKey(data, "tab")) { target = target === "roster" ? "composer" : "roster"; refresh(); return; }
      const thread = threads.current();
      if (!thread) return;
      if (matchesKey(data, "ctrl+s")) {
        notice = busy(thread) ? "Stopping selected request…" : "Selected thread is not running";
        void threads.stop(thread).catch((error) => { notice = safe(String(error)); refresh(); });
      } else if (matchesKey(data, "ctrl+y")) void copy(false);
      else if (matchesKey(data, "alt+y")) void copy(true);
      else if (matchesKey(data, "pageUp")) scrollBy(-Math.max(1, viewport - 1));
      else if (matchesKey(data, "pageDown")) scrollBy(Math.max(1, viewport - 1));
      else if (matchesKey(data, "ctrl+end")) {
        thread.following = true;
        view(thread).scroll.scrollToEnd();
      } else if (target === "roster") {
        if (keys.matches(data, "tui.select.confirm")) target = "composer";
      } else if (controlsVisible) {
        const editor = view(thread).editor;
        if (keys.matches(data, "tui.input.submit")) {
          try {
            if (threads.submit(thread, editor.getExpandedText(), ctx)) {
              editor.setText(""); thread.draft = ""; thread.following = true; notice = "";
            }
          } catch (error) { notice = safe(String(error)); }
        } else editor.handleInput(data);
      }
      refresh();
    },
    handleMouse(event) {
      if (event.type !== "wheel" || closed) return;
      // Pi fullscreen dispatches component-local coordinates. Consume all overlay
      // wheels, but only the rendered selected transcript may change reading state.
      const bounds = threadBounds;
      if (bounds && bounds.id === threads.selected &&
        bounds.rows === tui.terminal.rows && bounds.columns === tui.terminal.columns &&
        event.x >= bounds.x && event.x < bounds.x + bounds.width &&
        event.y >= bounds.y && event.y < bounds.y + bounds.height && event.wheelDelta)
        scrollBy(event.wheelDelta);
      return { handled: true };
    },
    invalidate() {
      threadBounds = undefined;
      native.invalidate();
      for (const item of views.values()) item.editor.invalidate();
    },
    dispose() {
      closed = true;
      threadBounds = undefined;
      unsubscribe();
      native.clear();
      views.clear();
    },
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  ModelRuntime,
  ModelRegistry,
  SessionManager,
  buildSessionContext,
  initTheme,
  createAgentSession,
  createEventBus,
  createExtensionRuntime,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  type AssistantMessage,
  type ToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  colorToOklch,
  oklchColor,
  getKeybindings,
  KeybindingsManager,
  TUI_KEYBINDINGS,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  Threads,
  ENTRY_TYPE,
  checkpoint,
  restore,
  messages,
  TOOL_NAMES,
  resources,
} from "../src/runtime.ts";
import { loadExtensionFromFactory } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { copyText } from "../src/copy.ts";
import { createHub } from "../src/hub.ts";
import btw from "../src/index.ts";
import { theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const directory = await mkdtemp(join(tmpdir(), "pi-btw-test-"));
process.env.PI_CODING_AGENT_DIR = directory;
await writeFile(join(directory, "auth.json"), "{}");
initTheme();
const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const calls: {
  context: TranscriptContext;
  finish: (text?: string) => void;
  tool: (name: string, args: Record<string, unknown>) => void;
  signal?: AbortSignal;
}[] = [];
const runtime = await ModelRuntime.create({
  authPath: join(directory, "auth.json"),
  modelsPath: null,
  allowModelNetwork: false,
});
runtime.registerProvider("btw-fixture", {
  api: "openai-completions",
  apiKey: "fixture-not-a-secret",
  baseUrl: "https://invalid.example",
  models: [
    {
      id: "test",
      name: "test",
      reasoning: false,
      input: ["text"],
      cost: zeroCost,
      contextWindow: 100000,
      maxTokens: 1000,
    },
  ],
  streamSimple(model, context, options) {
    const stream = createAssistantMessageEventStream();
    const reply: AssistantMessage = {
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: "text", text: "partial" }],
      stopReason: "stop",
      timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zeroCost },
    };
    let ended = false;
    const finish = (text = "complete") => {
      if (ended) return;
      ended = true;
      reply.content = [{ type: "text", text }];
      stream.push({ type: "done", reason: "stop", message: reply });
    };
    options?.signal?.addEventListener(
      "abort",
      () => {
        if (ended) return;
        ended = true;
        reply.stopReason = "aborted";
        stream.push({ type: "error", reason: "aborted", error: reply });
      },
      { once: true },
    );
    const tool = (name: string, args: Record<string, unknown>) => {
      if (ended) return;
      ended = true;
      reply.content = [{ type: "toolCall", id: "fixture-call", name, arguments: args } as ToolCall];
      reply.stopReason = "toolUse";
      stream.push({ type: "done", reason: "toolUse", message: reply });
    };
    calls.push({ context: structuredClone(context), finish, tool, signal: options?.signal });
    stream.push({ type: "start", partial: structuredClone(reply) });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "partial",
      partial: structuredClone(reply),
    });
    return stream;
  },
});
await runtime.refresh({ allowNetwork: false });
const model = runtime.getModel("btw-fixture", "test")!;

function context(manager = SessionManager.inMemory(directory)) {
  return {
    cwd: directory,
    mode: "tui",
    hasUI: true,
    model,
    thinkingLevel: "off",
    modelRegistry: new ModelRegistry(runtime),
    sessionManager: manager,
    getSystemPrompt: () => "Project instruction: preserve invariants.",
    ui: { theme, notify() {} },
  } as unknown as ExtensionCommandContext;
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Expected runtime condition was not reached");
}

test("real SDK: independent requests, frozen context, exact tools, stop, copy, parent exclusion and restore", async () => {
  const ctx = context();
  // Fixture parent manager uses the same public SDK as the children.
  const parent = ctx.sessionManager as SessionManager;
  parent.appendMessage({ role: "user", content: "parent-at-creation", timestamp: Date.now() });
  const threads = new Threads((data) => parent.appendCustomEntry(ENTRY_TYPE, data));
  const a = threads.create("same prompt", ctx);
  const b = threads.create("same prompt", ctx);
  assert.notEqual(a.id, b.id);
  assert.equal(threads.selected, b.id);
  threads.submit(a, "side A", ctx);
  threads.submit(b, "side B", ctx);
  assert.throws(() => threads.submit(a, "must-not-queue", ctx), /busy/);
  await until(() => calls.length === 2 && !!a.partial && !!b.partial);
  assert.deepEqual(a.session!.getActiveToolNames().sort(), [...TOOL_NAMES].sort());
  for (const call of calls) {
    assert.deepEqual(
      getCurrentTools(call.context.messages)
        .map((tool) => tool.name)
        .sort(),
      [...TOOL_NAMES].sort(),
    );
    assert.match(JSON.stringify(call.context), /parent-at-creation/);
  }
  assert.equal(
    a
      .session!.getAllTools()
      .some((tool) => ["write", "edit", "bash", "codemode"].includes(tool.name)),
    false,
  );
  const parentProjection = JSON.stringify(buildSessionContext(parent.getEntries()).messages);
  assert.doesNotMatch(parentProjection, /side A|side B|partial/);
  assert.equal(copyText(a, false), "partial");
  assert.doesNotMatch(copyText(a, true), /parent-at-creation|Project instruction/);
  assert.match(copyText(a, true), /## User\n\nside A/);
  await threads.stop(a);
  await until(() => a.status === "cancelled");
  assert.equal(b.status, "running");
  assert.ok(copyText(a, false).includes("partial"));
  calls.find((call) => JSON.stringify(call.context).includes("side B"))!.finish("answer B");
  await until(() => b.status === "idle");
  parent.appendMessage({ role: "user", content: "later-parent-secret", timestamp: Date.now() });
  threads.submit(b, "followup B", ctx);
  await until(() => calls.length === 3);
  assert.match(JSON.stringify(calls[2]!.context), /answer B|followup B/);
  assert.doesNotMatch(JSON.stringify(calls[2]!.context), /later-parent-secret|side A/);
  const interrupted = restore(checkpoint(b));
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.session, undefined);
  calls[2]!.finish("followup answer");
  await until(() => b.status === "idle");
  const saved = checkpoint(b);
  const restored = restore(saved);
  assert.deepEqual(messages(restored), messages(b));
  await threads.dispose(true);
  const restoredThreads = new Threads(() => {});
  await restoredThreads.load(ctx);
  assert.equal(restoredThreads.list.length, 2);
  assert.ok(restoredThreads.list.every((thread) => !thread.session));
  await restoredThreads.dispose(false);
});

test("real SDK executes local read and structurally rejects write, with no filesystem mutation", async () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const path = join(directory, "local-read.txt");
  await writeFile(path, "main-agent-change-visible");
  const a = threads.create("read probe", ctx);
  let count = calls.length;
  threads.submit(a, "read probe", ctx);
  await until(() => calls.length > count);
  calls.at(-1)!.tool("read", { path });
  count = calls.length;
  await until(() => calls.length > count);
  assert.match(JSON.stringify(calls.at(-1)!.context), /main-agent-change-visible/);
  calls.at(-1)!.tool("write", { path, content: "must not be written" });
  count = calls.length;
  await until(() => calls.length > count);
  const result = messages(a).findLast((message) => message.role === "toolResult");
  assert.ok(result?.role === "toolResult" && result.isError);
  assert.match(JSON.stringify(result), /not found|unknown|not available/i);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(path, "utf8"), "main-agent-change-visible");
  calls.at(-1)!.finish();
  await until(() => a.status === "idle");
  await threads.dispose(false);
});

test("branch restore and stale async work never append into the replacement branch", async () => {
  const manager = SessionManager.inMemory(directory);
  const ctx = context(manager);
  const root = manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
  const threads = new Threads((data) => manager.appendCustomEntry(ENTRY_TYPE, data));
  const a = threads.create("one", ctx);
  threads.submit(a, "one", ctx);
  await until(() => a.status === "running");
  manager.branch(root);
  await threads.load(ctx);
  const count = manager.getEntries().length;
  assert.equal(threads.list.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(manager.getEntries().length, count);
  assert.equal(a.session, undefined);
});

test("pending-request checkpoints include the user and completed tool output without duplicates", async () => {
  const saved: ReturnType<typeof checkpoint>[] = [];
  const ctx = context();
  const threads = new Threads((data) => saved.push(data));
  const thread = threads.create("checkpoint probe", ctx);
  const start = calls.length;
  threads.submit(thread, "checkpoint question", ctx);
  await until(() => calls.length > start);
  assert.deepEqual(messages(restore(saved.at(-1))), messages(thread));
  assert.equal(messages(restore(saved.at(-1))).length, 1);
  await writeFile(join(directory, "checkpoint.txt"), "completed tool output");
  calls.at(-1)!.tool("read", { path: join(directory, "checkpoint.txt") });
  await until(() => calls.length > start + 1);
  const restored = restore(saved.at(-1));
  assert.deepEqual(messages(restored), messages(thread));
  assert.deepEqual(
    messages(restored).map((message) => message.role),
    ["user", "assistant", "toolResult"],
  );
  assert.match(JSON.stringify(messages(restored)), /completed tool output/);
  await threads.dispose(false);
});

test("real SDK navigation fences children before delayed post-transition handlers and preserves outgoing checkpoints", async () => {
  const manager = SessionManager.inMemory(directory);
  const target = manager.appendCustomEntry("destination", {});
  manager.appendMessage({ role: "user", content: "outgoing branch", timestamp: Date.now() });
  const extensionRuntime = createExtensionRuntime();
  const bus = createEventBus();
  let delayed = false;
  let finishOutgoing: (() => void) | undefined;
  let cancel = false;
  const earlier = await loadExtensionFromFactory(
    (pi) => {
      pi.on("session_tree", async () => {
        if (manager.getLeafId() !== target) return;
        finishOutgoing?.();
        // Yield while the outgoing request could otherwise finish on the new leaf.
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(
          manager
            .getBranch()
            .some((entry) => entry.type === "custom" && entry.customType === ENTRY_TYPE),
          false,
        );
        delayed = true;
      });
    },
    directory,
    bus,
    extensionRuntime,
    "<earlier>",
  );
  const extension = await loadExtensionFromFactory(btw, directory, bus, extensionRuntime, "<btw>");
  const later = await loadExtensionFromFactory(
    (pi) => {
      pi.on("session_before_tree", () => (cancel ? { cancel: true } : undefined));
    },
    directory,
    bus,
    extensionRuntime,
    "<later>",
  );
  const loader = resources("navigation fixture");
  loader.getExtensions = () => ({
    extensions: [earlier, extension, later],
    errors: [],
    runtime: extensionRuntime,
  });
  const { session } = await createAgentSession({
    cwd: directory,
    model,
    modelRuntime: runtime,
    sessionManager: manager,
    resourceLoader: loader,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });
  const errors: string[] = [];
  await session.bindExtensions({
    mode: "tui",
    uiContext: {
      ...context(manager).ui,
      custom: async () => undefined as never,
    },
    onError: (error) => errors.push(error.error),
  });
  try {
    const start = calls.length;
    await session.prompt("/btw navigation question");
    await until(() => calls.length > start);
    finishOutgoing = () => calls.at(-1)!.finish("late completion");
    // A later extension can cancel after BTW has suspended its children.
    cancel = true;
    assert.equal((await session.navigateTree(target)).cancelled, true);
    const probe = new Threads(() => {});
    await probe.load(context(manager));
    assert.equal(probe.list.length, 1);
    assert.match(JSON.stringify(messages(probe.list[0]!)), /navigation question/);
    assert.equal(probe.list[0]!.status, "interrupted");
    await probe.dispose(false);
    // The same runtime is still usable following cancelled navigation.
    await session.prompt("/btw after cancellation");
    await until(() => calls.length > start + 1);
    calls.at(-1)!.tool("read", { path: join(directory, "auth.json") });
    await until(() => calls.length > start + 2);
    const outgoing = manager.getLeafId()!;
    cancel = false;
    assert.equal((await session.navigateTree(target)).cancelled, false);
    assert.equal(delayed, true);
    const destination = new Threads(() => {});
    await destination.load(context(manager));
    assert.equal(destination.list.length, 0);
    await destination.dispose(false);
    assert.equal((await session.navigateTree(outgoing)).cancelled, false);
    const restored = new Threads(() => {});
    await restored.load(context(manager));
    assert.equal(restored.list.length, 2);
    assert.match(JSON.stringify(messages(restored.list[0]!)), /navigation question/);
    assert.deepEqual(
      messages(restored.list[1]!).map((message) => message.role),
      ["user", "assistant", "toolResult"],
    );
    await restored.dispose(false);
    assert.deepEqual(errors, []);
  } finally {
    session.dispose();
  }
});

test("suspended threads can resume after cancelled navigation", async () => {
  const threads = new Threads(() => {});
  const ctx = context();
  const thread = threads.create("cancelled navigation", ctx);
  let start = calls.length;
  threads.submit(thread, "first request", ctx);
  await until(() => calls.length > start);
  await threads.suspend();
  assert.equal(threads.current(), thread);
  assert.equal(thread.status, "interrupted");
  assert.equal(thread.session, undefined);
  start = calls.length;
  threads.submit(thread, "resume request", ctx);
  await until(() => calls.length > start);
  assert.match(JSON.stringify(calls.at(-1)!.context), /first request/);
  assert.match(JSON.stringify(calls.at(-1)!.context), /resume request/);
  calls.at(-1)!.finish("resumed reply");
  await until(() => thread.status === "idle");
  await threads.dispose(false);
});

test("failure is per-thread, and a follow-up can recover", async () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const a = threads.create("failure", ctx);
  threads.submit(a, "failure", { ...ctx, model: undefined } as ExtensionContext);
  await until(() => a.status === "failed");
  assert.match(a.error!, /No parent model/);
  const start = calls.length;
  threads.submit(a, "recover", ctx);
  await until(() => calls.length > start);
  calls.at(-1)!.finish();
  await until(() => a.status === "idle");
  await threads.dispose(false);
});

test("real SDK missing credentials fail visibly without model substitution", async () => {
  runtime.registerProvider("btw-no-credentials", {
    api: "openai-completions",
    baseUrl: "https://invalid.example",
    models: [
      {
        id: "missing",
        name: "Missing credentials",
        reasoning: false,
        input: ["text"],
        cost: zeroCost,
        contextWindow: 10000,
        maxTokens: 100,
      },
    ],
  });
  await runtime.refresh({ allowNetwork: false });
  const ctx = context();
  const missing = runtime.getModel("btw-no-credentials", "missing")!;
  const threads = new Threads(() => {});
  const a = threads.create("missing auth", ctx);
  const count = calls.length;
  threads.submit(a, "missing auth", { ...ctx, model: missing } as ExtensionContext);
  await until(() => a.status === "failed");
  assert.match(a.error!, /API key|auth|credential/i);
  assert.match(a.model, /btw-no-credentials/);
  assert.equal(calls.length, count);
  await threads.dispose(false);
});

test("command: bare hub has no thread/request, identical prompts always create separately", async () => {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const saved: unknown[] = [];
  const api = {
    on() {},
    appendEntry(_type: string, data: unknown) {
      saved.push(data);
    },
    registerCommand(name: string, options: { handler: typeof handler }) {
      assert.equal(name, "btw");
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  btw(api);
  const ctx = context();
  ctx.ui.custom = async () => undefined as never;
  const start = calls.length;
  await handler!("", ctx);
  assert.equal(saved.length, 0);
  assert.equal(calls.length, start);
  // Missing model terminates immediately without a paid request or dangling runtime.
  const noModel = { ...ctx, model: undefined } as ExtensionCommandContext;
  await handler!("identical", noModel);
  await handler!("identical", noModel);
  const ids = new Set(saved.map((data) => (data as { id: string }).id));
  assert.equal(ids.size, 2);
});

test("copy strips controls, thinking, tool payloads and inherited context", () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const a = threads.create("copy probe", ctx);
  a.manager.appendMessage({ role: "user", content: "visible user", timestamp: Date.now() });
  a.manager.appendMessage({
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [
      { type: "thinking", thinking: "private thinking" },
      { type: "text", text: "\x1b[31mvisible reply\x1b[0m\x1b]52;c;payload\x07" },
      { type: "toolCall", id: "copy-call", name: "read", arguments: { path: "tool-private-path" } },
    ],
    stopReason: "toolUse",
    timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zeroCost },
  });
  a.manager.appendMessage({
    role: "toolResult",
    toolCallId: "copy-call",
    toolName: "read",
    content: [{ type: "text", text: "private tool result" }],
    isError: false,
    timestamp: Date.now(),
  });
  assert.equal(copyText(a, false), "visible reply");
  assert.equal(copyText(a, true), "## User\n\nvisible user\n\n## Assistant\n\nvisible reply");
});

test("native hub: Unicode width, compact/wide resize, focus, draft switching, busy draft retention and close", async () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const a = threads.create("中文 🧪 title", ctx);
  const b = threads.create("second", ctx);
  const terminal = { rows: 30, columns: 100 };
  const tui = { terminal, requestRender() {} } as unknown as TUI;
  let closed = false;
  const hub = createHub(threads, ctx, tui, getKeybindings(), () => {
    closed = true;
  });
  hub.focused = true;
  for (const [width, rows] of [
    [128, 30],
    [70, 33],
    [100, 30],
    [42, 24],
    [18, 18],
    [3, 2],
    [90, 35],
  ]) {
    terminal.rows = rows!;
    const lines = hub.render(width!);
    assert.ok(lines.length <= Math.max(1, Math.floor(rows! * 0.9)));
    assert.ok(
      lines.every((line) => visibleWidth(line) <= width!),
      `width ${width}`,
    );
    const rendered = lines.map(stripVTControlCharacters).join("\n");
    for (const thread of [a, b]) {
      assert.ok(!rendered.includes(thread.id.slice(0, 4)), `no roster ID at ${width}`);
      assert.ok(!rendered.includes(thread.id.slice(0, 8)), `no selected ID at ${width}`);
    }
    if (width! >= 70) {
      assert.ok(rendered.includes(`● ${b.title} · ${b.model}`));
      if (width! >= 76) {
        assert.ok(rendered.includes(`› ● ${b.title}`));
        assert.ok(rendered.includes(`● ${a.title}`));
        const [edge, left, right] = stripVTControlCharacters(lines[1]!).split("│");
        assert.equal(edge, "");
        assert.equal(left!.trim(), `● ${a.title}`, "roster starts immediately under outer frame");
        assert.equal(
          right!.trim(),
          `● ${b.title} · ${b.model}`,
          "selected header belongs only to thread column",
        );
        assert.equal(visibleWidth(left!), Math.min(32, Math.floor((width! - 4) / 3)) + 2);
      } else {
        assert.equal(
          stripVTControlCharacters(lines[1]!).split("│")[1]!.trim(),
          `● ${b.title} · ${b.model}`,
        );
        assert.ok(rendered.includes(`2/2 ${b.title}`));
      }
    }
    if (width! >= 70) {
      const rule = stripVTControlCharacters(lines[2]!);
      const roster = width! >= 76 ? Math.min(32, Math.floor((width! - 4) / 3)) : 0;
      const rightWidth = width! - 4 - (roster ? roster + 3 : 0);
      assert.equal(rule.split("│")[roster ? 2 : 1]!.trim(), "─".repeat(rightWidth));
      if (roster) assert.ok(!rule.split("│")[1]!.includes("─"), "header rule never crosses roster");
    }
    if (width! >= 16 && Math.floor(rows! * 0.9) >= 16) {
      const plain = lines.map(stripVTControlCharacters);
      const roster = width! >= 76 ? Math.min(32, Math.floor((width! - 4) / 3)) : 0;
      const divider = roster
        ? `├${"─".repeat(roster + 2)}┴${"─".repeat(width! - roster - 5)}┤`
        : `├${"─".repeat(width! - 2)}┤`;
      assert.equal(plain.at(-5), divider, `full-width footer divider at ${width}`);
      assert.equal(plain.filter((line) => line === divider).length, 1);
      assert.match(plain.at(-4)!, /Focus:/);
      assert.match(plain.at(-3)!, /Tab focus/);
      assert.match(plain.at(-2)!, /Enter send/);
      if (width! >= 128)
        assert.match(plain.at(-2)!, /Ctrl\+Y Copy reply · Alt\+Y Copy conversation · Esc close/);
      assert.equal(plain.at(-1), `╰${"─".repeat(width! - 2)}╯`);
    }
    hub.invalidate();
  }
  initTheme("light", false);
  hub.invalidate();
  terminal.rows = 30;
  assert.ok(hub.render(100).every((line) => visibleWidth(line) <= 100));
  initTheme("dark", false);
  hub.invalidate();
  hub.render(100);
  hub.handleInput!("draft B");
  assert.equal(b.draft, "draft B");
  hub.handleInput!("\x1b[A"); // Plain Up from initial composer focus selects older A.
  assert.equal(threads.selected, a.id);
  hub.render(100);
  hub.handleInput!("draft A");
  assert.equal(a.draft, "draft A");
  a.status = "running";
  hub.handleInput!("\r");
  assert.equal(a.draft, "draft A");
  assert.match(hub.render(100).join("\n"), /busy/);
  hub.handleInput!("\x1b");
  assert.equal(closed, true);
  assert.equal(a.status, "running");
  hub.dispose();
  await threads.dispose(false);
});

test("hub: arrows and remapped selection keys preserve drafts, focus, scroll and clamped order", async () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const a = threads.create("oldest", ctx);
  const b = threads.create("middle", ctx);
  const c = threads.create("newest", ctx);
  assert.deepEqual(threads.list, [a, b, c]);
  assert.equal(threads.selected, c.id);
  const keys = new KeybindingsManager(TUI_KEYBINDINGS, {
    "tui.select.up": "alt+k",
    "tui.select.down": "alt+j",
  });
  const tui = { terminal: { rows: 30, columns: 100 }, requestRender() {} } as unknown as TUI;
  const hub = createHub(threads, ctx, tui, keys, () => {});
  hub.focused = true;
  const render = () => hub.render(100).map(stripVTControlCharacters).join("\n");
  render();
  hub.handleInput!("draft C");
  hub.handleInput!("\x1b[A"); // Plain arrows still work when selection keys are remapped.
  assert.equal(threads.selected, b.id);
  render();
  hub.handleInput!("draft B");
  hub.handleInput!("\x1b[A");
  assert.equal(threads.selected, a.id);
  render();
  hub.handleInput!("first line");
  hub.handleInput!("\x1b\r"); // Shift+Enter: multiline editor remains available.
  hub.handleInput!("second line");
  hub.handleInput!("\x1b[A"); // Boundary must not reach the editor and move its cursor.
  hub.handleInput!("!");
  assert.equal(a.draft, "first line\nsecond line!");
  assert.equal(threads.selected, a.id);
  // Give the real scroll view enough native transcript content to scroll.
  a.manager.appendMessage({
    role: "user",
    timestamp: 1,
    content: Array.from({ length: 60 }, (_, i) => `Line ${i}`).join("\n"),
  });
  render();
  hub.handleInput!("\x1b[5~");
  const offset = a.offset;
  assert.equal(a.following, false);
  hub.handleInput!("\x1b[B");
  assert.equal(threads.selected, b.id);
  assert.match(render(), /Focus: composer/);
  hub.handleInput!("!");
  assert.equal(b.draft, "draft B!");
  hub.handleInput!("\t");
  assert.match(render(), /Focus: roster/);
  hub.handleInput!("\x1b[A");
  assert.equal(threads.selected, a.id);
  assert.match(render(), /Focus: roster/);
  assert.equal(a.offset, offset);
  assert.equal(a.following, false);
  hub.handleInput!("\x1bj"); // Remapped Down in roster.
  assert.equal(threads.selected, b.id);
  hub.handleInput!("\x1b[B");
  assert.equal(threads.selected, c.id);
  hub.handleInput!("\x1b[B");
  assert.equal(threads.selected, c.id);
  hub.handleInput!("\r"); // Roster Enter focuses, but does not submit.
  assert.match(render(), /Focus: composer/);
  hub.handleInput!("\x1bk"); // Remapped Up in composer.
  assert.equal(threads.selected, b.id);
  hub.handleInput!("\x1b[1;5A");
  assert.equal(threads.selected, a.id);
  hub.handleInput!("\x1b[1;5B");
  assert.equal(threads.selected, b.id);
  assert.deepEqual(
    [a.draft, b.draft, c.draft],
    ["first line\nsecond line!", "draft B!", "draft C"],
  );
  hub.dispose();
  const reopened = createHub(threads, ctx, tui, keys, () => {});
  assert.equal(threads.selected, b.id);
  assert.match(reopened.render(100).map(stripVTControlCharacters).join("\n"), /draft B!/);
  reopened.dispose();
  // A newly selected bottom entry stays visible even with an overflowing roster.
  for (let i = 0; i < 35; i++) threads.create(`Appended ${i}`, ctx);
  const overflowing = createHub(threads, ctx, tui, keys, () => {});
  assert.match(overflowing.render(100).map(stripVTControlCharacters).join("\n"), /› ● Appended 34/);
  overflowing.dispose();
  await threads.dispose(false);
});

test("hub: native wheel bounds, streaming, retained per-thread reading and return to live", () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const a = threads.create("older", ctx);
  const b = threads.create("newer", ctx);
  for (const thread of [a, b])
    thread.manager.appendMessage({
      role: "user",
      timestamp: 1,
      content: Array.from({ length: 80 }, (_, i) => `Reading line ${i}`).join("\n"),
    });
  const terminal = { rows: 30, columns: 100 };
  const tui = { terminal, requestRender() {} } as unknown as TUI;
  let hub = createHub(threads, ctx, tui, getKeybindings(), () => {});
  const render = () => hub.render(terminal.columns).map(stripVTControlCharacters);
  const wheel = (x: number, y: number, wheelDelta: number) =>
    hub.handleMouse!({
      type: "wheel",
      button: "none",
      x,
      y,
      screenX: x + 8,
      screenY: y + 2,
      width: terminal.columns,
      height: Math.floor(terminal.rows * 0.9),
      shift: false,
      alt: false,
      ctrl: false,
      wheelDelta,
    });
  let lines = render();
  const x = 2 + 32 + 3; // actual right-pane origin at width 100
  const y = 3; // outer frame, selected header, rule
  const liveOffset = b.offset;
  for (const [px, py] of [
    [x, 1],
    [x, 2],
    [2, y],
    [99, y],
    [x, lines.findIndex((l) => l.includes("Follow-up"))],
    [x, lines.length - 3],
  ]) {
    assert.deepEqual(wheel(px!, py!, -3), { handled: true });
    assert.equal(b.offset, liveOffset, "header/rule/roster/frame/composer/footer cannot scroll");
    assert.equal(b.following, true);
  }
  assert.deepEqual(wheel(x, y, -3), { handled: true });
  assert.equal(b.offset, liveOffset - 3);
  assert.equal(b.following, false);
  const readingOffset = b.offset;
  b.partial = {
    role: "assistant",
    content: [{ type: "text", text: "Streaming\nmore\noutput" }],
    api: "openai-completions",
    provider: "synthetic",
    model: "offline",
    timestamp: 2,
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  render();
  assert.equal(b.offset, readingOffset, "new streaming output preserves reading position");
  hub.handleInput!("\x1b[A");
  wheel(x, y, -3); // old selected bounds must not act on newly selected thread
  assert.equal(a.following, true);
  render();
  wheel(x, y, -6);
  const aOffset = a.offset;
  hub.handleInput!("\x1b[B");
  render();
  assert.equal(b.offset, readingOffset);
  assert.equal(b.following, false);
  hub.dispose();
  hub = createHub(threads, ctx, tui, getKeybindings(), () => {});
  render();
  assert.equal(b.offset, readingOffset, "close/reopen retains reading position");
  wheel(x, y, 10000);
  render();
  assert.equal(b.following, true, "wheel down to bottom resumes follow");
  wheel(x, y, -3);
  render();
  hub.handleInput!("\x1b[6~");
  render();
  assert.equal(b.following, true, "PgDn reaches live bottom");
  hub.handleInput!("\x1b[5~");
  render();
  assert.equal(b.following, false, "PgUp pauses follow");
  hub.handleInput!("\x1b[1;5F");
  render();
  assert.equal(b.following, true, "Ctrl+End returns live");
  hub.handleInput!("\x1b[A");
  render();
  assert.equal(a.offset, aOffset);
  assert.equal(a.following, false);
  terminal.columns = 70;
  wheel(x, y, -3);
  assert.equal(a.offset, aOffset, "resize rejects stale bounds before render");
  lines = render();
  wheel(2, 2, -3); // compact rule
  assert.equal(a.offset, aOffset);
  wheel(2, 4, -3); // compact transcript after fixed navigation row
  assert.equal(a.offset, aOffset - 3);
  terminal.rows = 2;
  render();
  const tinyOffset = a.offset;
  wheel(2, 4, -3);
  assert.equal(a.offset, tinyOffset, "tiny view has no transcript bounds");
  terminal.rows = 30;
  render();
  hub.invalidate();
  wheel(2, 4, -3);
  assert.equal(a.offset, tinyOffset, "invalidated layout cannot use stale bounds");
  hub.dispose();
});

test("SDK checkpoints restore creation order after a hub follow-up to an older thread", async () => {
  const manager = SessionManager.inMemory(directory);
  const ctx = context(manager);
  const root = manager.appendMessage({ role: "user", content: "root", timestamp: 1 });
  const threads = new Threads((data) => manager.appendCustomEntry(ENTRY_TYPE, data));
  const a = threads.create("older", ctx);
  const b = threads.create("newer", ctx);
  const creationLeaf = manager.getLeafId()!;
  const tui = { terminal: { rows: 30, columns: 100 }, requestRender() {} } as unknown as TUI;
  const hub = createHub(threads, ctx, tui, getKeybindings(), () => {});
  hub.render(100);
  hub.handleInput!("\x1b[A");
  hub.render(100);
  hub.handleInput!("FOLLOWUP older");
  const count = calls.length;
  hub.handleInput!("\r");
  await until(() => calls.length > count);
  assert.equal(a.status, "running");
  assert.equal(b.status, "idle");
  assert.match(JSON.stringify(calls.at(-1)!.context), /FOLLOWUP older/);
  calls.at(-1)!.finish("older answer");
  await until(() => a.status === "idle");
  assert.deepEqual(
    threads.list.map((thread) => thread.id),
    [a.id, b.id],
  );
  hub.dispose();
  await threads.dispose(false);
  const restored = new Threads(() => {});
  await restored.load(ctx);
  assert.deepEqual(
    restored.list.map((thread) => thread.id),
    [a.id, b.id],
  );
  assert.equal(restored.selected, b.id);
  assert.match(JSON.stringify(messages(restored.list[0]!)), /older answer/);
  // Older branches containing only creation checkpoints retain the same order.
  manager.branch(creationLeaf);
  await restored.load(ctx);
  assert.deepEqual(
    restored.list.map((thread) => thread.id),
    [a.id, b.id],
  );
  assert.doesNotMatch(JSON.stringify(messages(restored.list[0]!)), /FOLLOWUP older/);
  manager.branch(root);
  await restored.load(ctx);
  assert.equal(restored.list.length, 0);
  await restored.dispose(false);
});

test("hub: exhaustive colored circles replace status labels in roster and header", async () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const expected = [
    ["starting", "◉", "accent"],
    ["running", "◉", "accent"],
    ["idle", "●", "success"],
    ["failed", "●", "error"],
    ["cancelled", "○", "muted"],
    ["interrupted", "○", "warning"],
  ] as const;
  const items = expected.map(([status], index) => {
    const thread = threads.create(`Topic ${index}`, ctx);
    thread.status = status;
    return thread;
  });
  const tui = { terminal: { rows: 40, columns: 128 }, requestRender() {} } as unknown as TUI;
  const hub = createHub(threads, ctx, tui, getKeybindings(), () => {});
  for (const [index, [status, glyph, color]] of expected.entries()) {
    threads.selected = items[index]!.id;
    const lines = hub.render(128);
    const plain = lines.map(stripVTControlCharacters);
    assert.ok(lines[1]!.includes(theme.fg(color, glyph)), `${status} header color`);
    assert.ok(plain[1]!.includes(`${glyph} Topic ${index} · not started`));
    const roster = lines
      .slice(1)
      .find((line) =>
        stripVTControlCharacters(line).split("│")[1]?.includes(`› ${glyph} Topic ${index}`),
      );
    assert.ok(roster?.includes(theme.fg(color, glyph)), `${status} roster color`);
    assert.doesNotMatch(
      plain.join("\n"),
      /\b(starting|running|idle|failed|cancelled|interrupted)\b/,
    );
  }
  hub.dispose();
  await threads.dispose(false);
});

test("hub: neutral panel matches reference paint in dark/light across SGR resets and native blocks", async () => {
  const ctx = context();
  const threads = new Threads(() => {});
  const thread = threads.create("Panel probe", ctx);
  thread.manager.appendMessage({ role: "user", timestamp: 1, content: "Native user block" });
  const tui = { terminal: { rows: 30, columns: 100 }, requestRender() {} } as unknown as TUI;
  for (const name of ["dark", "light"] as const) {
    initTheme(name, false);
    // Force both reset forms through the real hub without changing the theme palette.
    const resetTheme = Object.create(theme) as typeof theme;
    resetTheme.fg = (color, text) => theme.fg(color, text) + "\x1b[0m\x1b[49m";
    const resetContext = { ...ctx, ui: { ...ctx.ui, theme: resetTheme } };
    const panelBg = oklchColor(colorToOklch(theme.colors.customMessageBg).l, 0, 0);
    // oxlint-disable-next-line no-control-regex -- Match the ANSI background reset.
    const restoreBg = theme.style("", { bg: panelBg }).replace(/\x1b\[49m$/, "");
    // Exact subagents paint baseline, including padding and both ANSI reset forms.
    const baseline = (text: string, width: number) => {
      const padded = text + " ".repeat(Math.max(0, width - visibleWidth(text)));
      return padded
        .split("\x1b[0m")
        .map((part) => theme.style(part.replaceAll("\x1b[49m", restoreBg), { bg: panelBg }))
        .join("\x1b[0m");
    };
    const hub = createHub(threads, resetContext, tui, getKeybindings(), () => {});
    const lines = hub.render(100);
    const frame =
      resetTheme.fg("border", "╭") +
      resetTheme.fg("accent", " BTW · 1 threads ") +
      resetTheme.fg("border", "─".repeat(81) + "╮");
    assert.equal(lines[0], baseline(frame, 100), `${name} exact reference frame`);
    assert.notEqual(lines[0], theme.bg("customMessageBg", frame));
    assert.ok(lines.every((line) => visibleWidth(line) === 100));
    assert.match(lines.map(stripVTControlCharacters).join("\n"), /Native user block/);
    assert.ok(
      lines.some((line) => line.includes(theme.getBgAnsi("userMessageBg"))),
      "native user background retained",
    );
    hub.dispose();
  }
  initTheme("dark", false);
  await threads.dispose(false);
});

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

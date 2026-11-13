import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  ModelRuntime, ModelRegistry, SessionManager, buildSessionContext, initTheme,
  type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage, type ToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { getKeybindings, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { Threads, ENTRY_TYPE, checkpoint, restore, messages, TOOL_NAMES } from "../src/runtime.ts";
import { copyText } from "../src/copy.ts";
import { createHub } from "../src/hub.ts";
import btw from "../src/index.ts";
import { theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const directory = await mkdtemp(join(tmpdir(), "pi-btw-test-"));
process.env.PI_CODING_AGENT_DIR = directory;
await writeFile(join(directory, "auth.json"), "{}");
initTheme();
const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const calls: { context: TranscriptContext; finish: (text?: string) => void; tool: (name: string, args: Record<string, unknown>) => void; signal?: AbortSignal }[] = [];
const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null, allowModelNetwork: false });
runtime.registerProvider("btw-fixture", {
  api: "openai-completions", apiKey: "fixture-not-a-secret", baseUrl: "https://invalid.example",
  models: [{ id: "test", name: "test", reasoning: false, input: ["text"], cost: zeroCost, contextWindow: 100000, maxTokens: 1000 }],
  streamSimple(model, context, options) {
    const stream = createAssistantMessageEventStream();
    const reply: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [{ type: "text", text: "partial" }], stopReason: "stop", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zeroCost },
    };
    let ended = false;
    const finish = (text = "complete") => {
      if (ended) return;
      ended = true;
      reply.content = [{ type: "text", text }];
      stream.push({ type: "done", reason: "stop", message: reply });
    };
    options?.signal?.addEventListener("abort", () => {
      if (ended) return;
      ended = true;
      reply.stopReason = "aborted";
      stream.push({ type: "error", reason: "aborted", error: reply });
    }, { once: true });
    const tool = (name: string, args: Record<string, unknown>) => {
      if (ended) return;
      ended = true;
      reply.content = [{ type: "toolCall", id: "fixture-call", name, arguments: args } as ToolCall];
      reply.stopReason = "toolUse";
      stream.push({ type: "done", reason: "toolUse", message: reply });
    };
    calls.push({ context: structuredClone(context), finish, tool, signal: options?.signal });
    stream.push({ type: "start", partial: structuredClone(reply) });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "partial", partial: structuredClone(reply) });
    return stream;
  },
});
await runtime.refresh({ allowNetwork: false });
const model = runtime.getModel("btw-fixture", "test")!;

function context(manager = SessionManager.inMemory(directory)) {
  return {
    cwd: directory, mode: "tui", hasUI: true, model, thinkingLevel: "off",
    modelRegistry: new ModelRegistry(runtime), sessionManager: manager,
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
  ctx.sessionManager; // Fixture parent manager uses the same public SDK as the children.
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
    assert.deepEqual(getCurrentTools(call.context.messages).map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
    assert.match(JSON.stringify(call.context), /parent-at-creation/);
  }
  assert.equal(a.session!.getAllTools().some((tool) => ["write", "edit", "bash", "codemode"].includes(tool.name)), false);
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
    api: "openai-completions", baseUrl: "https://invalid.example",
    models: [{ id: "missing", name: "Missing credentials", reasoning: false, input: ["text"],
      cost: zeroCost, contextWindow: 10000, maxTokens: 100 }],
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
    on() {}, appendEntry(_type: string, data: unknown) { saved.push(data); },
    registerCommand(name: string, options: { handler: typeof handler }) { assert.equal(name, "btw"); handler = options.handler; },
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
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "thinking", thinking: "private thinking" },
      { type: "text", text: "\x1b[31mvisible reply\x1b[0m\x1b]52;c;payload\x07" },
      { type: "toolCall", id: "copy-call", name: "read", arguments: { path: "tool-private-path" } }],
    stopReason: "toolUse", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zeroCost },
  });
  a.manager.appendMessage({ role: "toolResult", toolCallId: "copy-call", toolName: "read",
    content: [{ type: "text", text: "private tool result" }], isError: false, timestamp: Date.now() });
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
  const hub = createHub(threads, ctx, tui, getKeybindings(), () => { closed = true; });
  hub.focused = true;
  for (const [width, rows] of [[128, 30], [70, 33], [100, 30], [42, 24], [18, 18], [3, 2], [90, 35]]) {
    terminal.rows = rows!;
    const lines = hub.render(width!);
    assert.ok(lines.length <= Math.max(1, Math.floor(rows! * .9)));
    assert.ok(lines.every((line) => visibleWidth(line) <= width!), `width ${width}`);
    const rendered = lines.map(stripVTControlCharacters).join("\n");
    for (const thread of [a, b]) {
      assert.ok(!rendered.includes(thread.id.slice(0, 4)), `no roster ID at ${width}`);
      assert.ok(!rendered.includes(thread.id.slice(0, 8)), `no selected ID at ${width}`);
    }
    if (width! >= 70) {
      assert.ok(rendered.includes(`${b.title} · ${b.status} · ${b.model}`));
      if (width! >= 76) {
        assert.ok(rendered.includes(`› ${b.status} ${b.title}`));
        assert.ok(rendered.includes(`${a.status} ${a.title}`));
      } else assert.ok(rendered.includes(`1/2 ${b.title}`));
    }
    if (width! >= 16 && Math.floor(rows! * .9) >= 16) {
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
  hub.handleInput!("\x1b[1;5A"); // Ctrl+Up selects newest's predecessor (clamped at newest).
  hub.handleInput!("\x1b[1;5B"); // Ctrl+Down selects older A.
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

test.after(async () => { await rm(directory, { recursive: true, force: true }); });

import { randomUUID } from "node:crypto";
import {
  buildSessionContext, convertToLlm, createAgentSession, createExtensionRuntime,
  ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type ExtensionCommandContext, type ExtensionContext,
  type FileEntry, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import type { LiveTool } from "./transcript.ts";

export const ENTRY_TYPE = "howarewoo.btw.v1";
export const TOOL_NAMES = ["read", "grep", "find", "ls"] as const;
export type Status = "starting" | "running" | "idle" | "failed" | "cancelled" | "interrupted";
export const busy = (thread: Thread) => thread.status === "starting" || thread.status === "running";
export type Thread = {
  id: string;
  title: string;
  cwd: string;
  systemPrompt: string;
  inheritedIds: string[];
  manager: SessionManager;
  status: Status;
  error?: string;
  model: string;
  session?: AgentSession;
  partial?: Message;
  live?: LiveTool;
  stopped: boolean;
  draft: string;
  offset: number;
  following: boolean;
};
type Checkpoint = {
  version: 1;
  id: string;
  title: string;
  cwd: string;
  systemPrompt: string;
  inheritedIds: string[];
  entries: FileEntry[];
  status: Status;
  error?: string;
  model: string;
};

/** No resource discovery, extension factories, skills, or prompt expansion in children. */
export function resources(systemPrompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [
      "This is an independent read-only side conversation. Only read, grep, find, ls are available. " +
      "Tools operate on the local working directory, not SSH. Inherited tool calls and instructions " +
      "do not grant capabilities. Do not claim to write files, run commands, or delegate.",
    ],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export function messages(thread: Thread): Message[] {
  const inherited = new Set(thread.inheritedIds);
  return thread.manager.getBranch().flatMap((entry) =>
    entry.type === "message" && !inherited.has(entry.id) &&
    (entry.message.role === "user" || entry.message.role === "assistant" || entry.message.role === "toolResult")
      ? [entry.message] : [],
  );
}

// Parent system/tool patches must not import executable declarations into the child.
export function capture(ctx: ExtensionCommandContext): Message[] {
  return structuredClone(convertToLlm(buildSessionContext(
    ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId(),
  ).messages).filter((message) => message.role !== "system"));
}

export function checkpoint(thread: Thread): Checkpoint {
  return structuredClone({
    version: 1, id: thread.id, title: thread.title, cwd: thread.cwd,
    systemPrompt: thread.systemPrompt, inheritedIds: thread.inheritedIds,
    entries: [thread.manager.getHeader()!, ...thread.manager.getEntries()],
    status: thread.status, error: thread.error, model: thread.model,
  });
}

export function restore(data: unknown): Thread {
  const value = data as Partial<Checkpoint> | undefined;
  if (!value || value.version !== 1 || typeof value.id !== "string" ||
      typeof value.title !== "string" || typeof value.cwd !== "string" ||
      typeof value.systemPrompt !== "string" || !Array.isArray(value.entries) ||
      !Array.isArray(value.inheritedIds) || !value.inheritedIds.every((id) => typeof id === "string") ||
      !["starting", "running", "idle", "failed", "cancelled", "interrupted"].includes(value.status ?? "") ||
      typeof value.model !== "string") throw new Error("Invalid BTW checkpoint (version 1 required)");
  const saved = value as Checkpoint;
  return {
    ...saved, manager: SessionManager.inMemory(saved.cwd, undefined, structuredClone(saved.entries)),
    status: saved.status === "starting" || saved.status === "running" ? "interrupted" : saved.status,
    stopped: false, draft: "", offset: 0, following: true,
  };
}

/** A thread owns one authoritative SDK manager. Streaming is only an ephemeral projection. */
export class Threads {
  readonly list: Thread[] = [];
  selected?: string;
  private epoch = 0;
  private listeners = new Set<() => void>();
  constructor(private save: (data: Checkpoint) => void) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  changed() { for (const listener of this.listeners) listener(); }
  current() { return this.list.find((thread) => thread.id === this.selected); }
  private persist(thread: Thread) { this.save(checkpoint(thread)); }

  create(prompt: string, ctx: ExtensionCommandContext): Thread {
    const manager = SessionManager.inMemory(ctx.cwd);
    const inheritedIds = capture(ctx).map((message) => manager.appendMessage(message));
    const thread: Thread = {
      id: randomUUID(), title: prompt, cwd: ctx.cwd,
      systemPrompt: ctx.getSystemPrompt(), inheritedIds, manager,
      status: "idle", model: "not started", stopped: false,
      draft: "", offset: 0, following: true,
    };
    this.list.push(thread);
    this.selected = thread.id;
    this.persist(thread);
    this.changed();
    return thread;
  }

  async load(ctx: ExtensionContext) {
    await this.dispose(false);
    const saved = new Map<string, Thread>();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      try {
        const thread = restore(entry.data);
        saved.set(thread.id, thread);
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    }
    // Map updates replace checkpoints without moving the first creation entry.
    this.list.push(...saved.values());
    this.selected = this.list.at(-1)?.id;
    this.changed();
  }

  /** Rejects synchronously before any await, so two submits can never queue one thread. */
  submit(thread: Thread, prompt: string, ctx: ExtensionContext): boolean {
    if (busy(thread)) throw new Error("Thread is busy. Draft kept; wait or Stop this request.");
    if (!prompt.trim()) return false;
    if (!this.list.includes(thread)) throw new Error("Thread is no longer in the current branch");
    thread.status = "starting";
    thread.error = undefined;
    thread.stopped = false;
    thread.model = ctx.model ? `${ctx.model.provider}/${ctx.model.id} · ${ctx.thinkingLevel}` : "no parent model";
    this.persist(thread);
    this.changed();
    void this.run(thread, prompt, ctx, this.epoch);
    return true;
  }

  private async run(thread: Thread, prompt: string, ctx: ExtensionContext, epoch: number) {
    const active = () => epoch === this.epoch && this.list.includes(thread);
    try {
      const model = ctx.model;
      const thinkingLevel = ctx.thinkingLevel ?? "off";
      if (!model) throw new Error("No parent model selected");
      if (thread.cwd !== ctx.cwd) throw new Error("Thread working directory differs from parent");
      // A child runtime inherits parent provider configuration, but never parent extensions.
      const runtime = thread.session?.modelRuntime ?? await ModelRuntime.create({ allowModelNetwork: false });
      if (!active() || thread.stopped) return;
      const native = ctx.modelRegistry.getRegisteredNativeProvider(model.provider);
      const config = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);
      if (native) runtime.registerNativeProvider(native);
      else if (config) runtime.registerProvider(model.provider, config);
      if (ctx.modelRegistry.getProviderAuthStatus(model.provider).source === "runtime") {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok) throw new Error(auth.error);
        if (auth.apiKey) await runtime.setRuntimeApiKey(model.provider, auth.apiKey);
      }
      await runtime.refresh({ allowNetwork: false });
      if (!active() || thread.stopped) return;
      if (!thread.session) {
        const created = await createAgentSession({
          cwd: thread.cwd, model, thinkingLevel,
          modelRuntime: runtime, sessionManager: thread.manager,
          tools: [...TOOL_NAMES], resourceLoader: resources(thread.systemPrompt),
          settingsManager: SettingsManager.inMemory({
            compaction: { enabled: false }, retry: { enabled: false },
          }),
        });
        if (!active() || thread.stopped) { created.session.dispose(); return; }
        thread.session = created.session;
        if (created.modelFallbackMessage) throw new Error(created.modelFallbackMessage);
        const actual = thread.session.getActiveToolNames().sort();
        if (actual.join() !== [...TOOL_NAMES].sort().join()) throw new Error("Child tool allowlist mismatch");
        thread.session.subscribe((event) => {
          if (!active()) return;
          if (event.type === "message_update" && event.message.role === "assistant") thread.partial = event.message;
          if (event.type === "message_end") {
            // Pi 1.5.2 appends the message synchronously after public listeners return.
            queueMicrotask(() => {
              if (!active()) return;
              thread.partial = undefined;
              this.persist(thread);
              this.changed();
            });
          }
          if (event.type === "tool_execution_start" || event.type === "tool_execution_update")
            thread.live = { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args,
              ...(event.type === "tool_execution_update" ? { content: event.partialResult.content } : {}) };
          if (event.type === "tool_execution_end") thread.live = undefined;
          this.changed();
        });
      } else {
        await thread.session.setModel(model);
        thread.session.setThinkingLevel(thinkingLevel);
      }
      if (!active() || thread.stopped) return;
      thread.status = "running";
      this.changed();
      await thread.session.prompt(prompt, { expandPromptTemplates: false });
      if (!active()) return;
      const last = messages(thread).findLast((message) => message.role === "assistant");
      if (last?.role === "assistant") {
        thread.model = `${last.provider}/${last.model} · ${thread.session.thinkingLevel}`;
        if (last.stopReason === "error") throw new Error(last.errorMessage || "Model request failed");
      }
      thread.status = thread.stopped || (last?.role === "assistant" && last.stopReason === "aborted") ? "cancelled" : "idle";
    } catch (error) {
      if (!active()) return;
      thread.status = thread.stopped ? "cancelled" : "failed";
      thread.error = String(error);
    } finally {
      if (active()) {
        if (thread.status === "starting") thread.status = thread.stopped ? "cancelled" : "failed";
        thread.partial = undefined;
        thread.live = undefined;
        this.persist(thread);
        this.changed();
      }
    }
  }

  async stop(thread: Thread) {
    if (!busy(thread)) return;
    thread.stopped = true;
    await thread.session?.abort();
    // Starting work may still be awaiting setup. Keep it busy until its finally runs.
    this.changed();
  }

  /** Fence and checkpoint before navigation; keep threads usable if navigation is cancelled. */
  async suspend(save = true) {
    ++this.epoch;
    await Promise.all(this.list.map(async (thread) => {
      thread.stopped = true;
      await thread.session?.abort();
      thread.session?.dispose();
      thread.session = undefined;
      if (busy(thread)) thread.status = "interrupted";
      thread.partial = undefined;
      thread.live = undefined;
      if (save) this.persist(thread);
    }));
    this.changed();
  }

  async dispose(save: boolean) {
    await this.suspend(save);
    this.list.splice(0);
    this.selected = undefined;
    this.changed();
  }
}

import {
  AssistantMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  getMarkdownTheme,
  createReadToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Message } from "@earendil-works/pi-ai";

export function safe(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g,
      " ",
    )
    .replaceAll("\t", "  ");
}

// Inputs are sanitized before native rendering. Only native SGR survives the output boundary,
// not OSC links/shell zones, image protocols or cursor-control sequences.
export function nativeText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .split(/(\x1b\[[0-9;:]*m)/g)
    .map((part, index) => (index % 2 ? part : safe(part)))
    .join("");
}
function safeValue(value: unknown): unknown {
  if (typeof value === "string") return safe(value);
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [safe(key), safeValue(item)]),
    );
  return value;
}

type Messages = Message[];
export type ThreadDependencies = Readonly<{
  tui: TUI;
  cwd: string;
}>;
export type LiveTool = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  content?: readonly { type: string; text?: string; mimeType?: string }[];
};
const textContent = (content: readonly { type: string; text?: string; mimeType?: string }[]) =>
  content.flatMap((block) =>
    block.type === "text"
      ? [{ type: "text", text: safe(block.text ?? "") }]
      : block.type === "image"
        ? [{ type: "text", text: `[image ${safe(block.mimeType ?? "unknown")}; payload omitted]` }]
        : [],
  );

/** Sanitized observer projection using Pi's native chat and tool components. */
export function createNativeThread({ tui, cwd }: ThreadDependencies) {
  const renderers = new Map<string, ToolRenderers>(
    [
      createReadToolDefinition(cwd),
      createGrepToolDefinition(cwd),
      createFindToolDefinition(cwd),
      createLsToolDefinition(cwd),
    ].map(({ name, renderShell, renderCall, renderResult }) => [
      name,
      { renderShell, renderCall, renderResult } as ToolRenderers,
    ]),
  );
  const cache = new Map<string, { signature: string; component: Component }>();
  let generation: string | undefined;
  return {
    render(
      ref: string,
      messages: Messages,
      partial: Messages[number] | undefined,
      live: LiveTool | undefined,
      width: number,
    ): string[] {
      if (generation !== ref) {
        cache.clear();
        generation = ref;
      }
      const used = new Set<string>();
      const components: Component[] = [];
      const append = (
        key: string,
        value: unknown,
        build: () => Component,
        update?: (component: Component) => void,
      ) => {
        const signature = JSON.stringify(value);
        let entry = cache.get(key);
        if (!entry || entry.signature !== signature) {
          if (entry && update) {
            update(entry.component);
            entry.signature = signature;
          } else {
            entry = { signature, component: build() };
            cache.set(key, entry);
          }
        }
        used.add(key);
        components.push(entry.component);
      };
      const all = partial ? [...messages, partial] : messages;
      const results = new Map(
        all.flatMap((message) =>
          message.role === "toolResult" ? [[message.toolCallId, message] as const] : [],
        ),
      );
      const toolIds = new Set<string>();
      const tool = (name: string, id: string, args: unknown, failure?: string) => {
        if (toolIds.has(id)) return;
        toolIds.add(id);
        const result = results.get(id);
        const active = live?.toolCallId === id ? live : undefined;
        const content = result
          ? textContent(result.content)
          : active?.content
            ? textContent(active.content)
            : failure
              ? [{ type: "text", text: safe(failure) }]
              : undefined;
        const toolArgs = safeValue(active?.args ?? args);
        const output = content
          ? { content, details: undefined, isError: result?.isError ?? !!failure }
          : undefined;
        append("tool:" + id, [name, toolArgs, output, !!active], () => {
          const component = new ToolExecutionComponent(
            safe(name),
            safe(id),
            toolArgs,
            { showImages: false },
            renderers.get(name),
            tui,
            cwd,
          );
          component.setExpanded(true);
          component.setArgsComplete();
          // Do not mark execution started: this observer must not invent elapsed clocks/timers.
          if (output) component.updateResult(output, !!active && !result);
          return component;
        });
      };
      all.forEach((message, index) => {
        if (message.role === "system") return;
        if (message.role === "assistant") {
          const content: typeof message.content = message.content.map((block) =>
            block.type === "text"
              ? { type: "text", text: safe(block.text) }
              : block.type === "thinking"
                ? { type: "thinking", thinking: safe(block.thinking) }
                : {
                    type: "toolCall",
                    id: safe(block.id),
                    name: safe(block.name),
                    arguments: safeValue(block.arguments) as typeof block.arguments,
                  },
          );
          const projected = {
            role: message.role,
            api: message.api,
            provider: message.provider,
            model: message.model,
            timestamp: message.timestamp,
            usage: message.usage,
            stopReason: message.stopReason,
            content,
            errorMessage: message.errorMessage ? safe(message.errorMessage) : undefined,
          };
          const streaming = message === partial;
          append(
            "assistant:" + index,
            [projected, streaming],
            () => {
              const component = new AssistantMessageComponent(projected, false, getMarkdownTheme());
              component.updateContent(projected, streaming);
              return component;
            },
            (component) =>
              (component as AssistantMessageComponent).updateContent(projected, streaming),
          );
          for (const block of message.content)
            if (block.type === "toolCall")
              tool(
                block.name,
                block.id,
                block.arguments,
                message.stopReason === "error" || message.stopReason === "aborted"
                  ? message.errorMessage || "Operation aborted"
                  : undefined,
              );
          if (
            message.errorMessage &&
            message.stopReason !== "error" &&
            message.stopReason !== "aborted"
          ) {
            append(
              "error:" + index,
              message.errorMessage,
              () => new Text("Error: " + safe(message.errorMessage!), 1, 0),
            );
          }
        } else if (message.role === "toolResult") {
          if (!toolIds.has(message.toolCallId)) tool(message.toolName, message.toolCallId, {});
        } else if ("content" in message) {
          const text =
            typeof message.content === "string"
              ? safe(message.content)
              : Array.isArray(message.content)
                ? textContent(message.content)
                    .map((block) => block.text)
                    .join("\n")
                : "";
          append("user:" + index, text, () => new UserMessageComponent(text, getMarkdownTheme()));
        }
      });
      if (live && !toolIds.has(live.toolCallId)) tool(live.toolName, live.toolCallId, live.args);
      for (const key of cache.keys()) if (!used.has(key)) cache.delete(key);
      return components.flatMap((component) =>
        component
          .render(Math.max(12, width))
          .flatMap((line) => wrapTextWithAnsi(nativeText(line), Math.max(1, width))),
      );
    },
    invalidate() {
      for (const entry of cache.values()) entry.component.invalidate();
    },
    clear() {
      cache.clear();
      generation = undefined;
    },
  };
}

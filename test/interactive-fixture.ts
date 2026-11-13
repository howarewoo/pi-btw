/** Deterministic, offline model for manual Pi TUI smoke tests. Not installed by the package. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("btw-smoke", {
    api: "openai-completions",
    apiKey: "offline-fixture",
    baseUrl: "https://invalid.example",
    models: [
      {
        id: "offline",
        name: "Offline smoke fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 1000,
      },
    ],
    streamSimple(model, _context, options) {
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "" }],
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      let count = 0;
      stream.push({ type: "start", partial: structuredClone(message) });
      const timer = setInterval(() => {
        if (options?.signal?.aborted) {
          clearInterval(timer);
          message.stopReason = "aborted";
          stream.push({ type: "error", reason: "aborted", error: message });
          return;
        }
        const delta = `Offline fixture line ${++count}: 中文 streaming side conversation.\n`;
        message.content = [
          {
            type: "text",
            text: (message.content[0]!.type === "text" ? message.content[0]!.text : "") + delta,
          },
        ];
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta,
          partial: structuredClone(message),
        });
        if (count === 20) {
          clearInterval(timer);
          stream.push({ type: "done", reason: "stop", message });
        }
      }, 300);
      return stream;
    },
  });
}

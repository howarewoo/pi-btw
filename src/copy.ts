import type { Message } from "@earendil-works/pi-ai";
import { messages, type Thread } from "./runtime.ts";
import { safe } from "./transcript.ts";

function text(message: Message): string {
  if (message.role !== "assistant" && message.role !== "user") return "";
  return safe(
    typeof message.content === "string"
      ? message.content
      : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
  );
}

export function copyText(thread: Thread, whole: boolean): string {
  const all = [...messages(thread), ...(thread.partial ? [thread.partial] : [])];
  if (!whole) {
    const latest = all.findLast((message) => message.role === "assistant" && text(message).trim());
    return latest ? text(latest) : "";
  }
  return all
    .flatMap((message) => {
      const body = text(message);
      return body.trim() ? [`## ${message.role === "user" ? "User" : "Assistant"}\n\n${body}`] : [];
    })
    .join("\n\n");
}

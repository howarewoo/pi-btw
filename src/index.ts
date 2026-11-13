import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Threads, ENTRY_TYPE } from "./runtime.ts";
import { createHub } from "./hub.ts";

export default function btw(pi: ExtensionAPI) {
  const threads = new Threads((data) => pi.appendEntry(ENTRY_TYPE, data));
  let close: (() => void) | undefined;
  let open = false;
  const load = async (ctx: ExtensionContext) => { close?.(); await threads.load(ctx); };
  pi.on("session_start", (_event, ctx) => load(ctx));
  pi.on("session_before_tree", () => threads.suspend());
  pi.on("session_before_switch", () => threads.suspend());
  pi.on("session_before_fork", () => threads.suspend());
  pi.on("session_tree", (_event, ctx) => load(ctx));
  pi.on("session_shutdown", async () => { close?.(); await threads.dispose(true); });
  pi.registerCommand("btw", {
    description: "Open side-conversation hub; a prompt always starts a fresh read-only thread",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/btw requires interactive Pi mode", "error");
        return;
      }
      if (args.trim()) {
        const thread = threads.create(args.trim(), ctx);
        threads.submit(thread, args.trim(), ctx);
      }
      if (open) { threads.changed(); return; }
      open = true;
      try {
        await ctx.ui.custom<void>((tui, _theme, keys, done) => {
          close = () => done();
          return createHub(threads, ctx, tui, keys, () => done());
        }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" } });
      } finally { close = undefined; open = false; }
    },
  });
}

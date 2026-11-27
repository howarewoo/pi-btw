import assert from "node:assert/strict";

// Per-repo values for the shared scripts/test-package.mjs smoke test.
export default {
  // Every packed tar entry must match; anything else fails before installation.
  files:
    /^package\/(?:index\.ts|src\/[\w-]+\.ts|docs\/[\w-]+\.md|docs\/images\/[\w-]+\.svg|package\.json|README\.md|CHANGELOG\.md|LICENSE)$/,
  requiredFiles: ["README.md", "CHANGELOG.md", "LICENSE"],
  tools: [],
  commands: ["btw"],
  // Execute a representative command boundary without a model/provider or interactive TUI.
  async verify({ extension }) {
    const notices = [];
    await extension.commands
      .get("btw")
      .handler("", { mode: "rpc", ui: { notify: (...args) => notices.push(args) } });
    assert.deepEqual(notices, [["/btw requires interactive Pi mode", "error"]]);
  },
};

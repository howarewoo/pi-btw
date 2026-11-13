import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/release-check.mjs", import.meta.url));

for (const scenario of [
  "empty unreleased",
  "pending changes",
  "tag mismatch",
  "lock mismatch",
  "missing notes",
  "duplicate release",
])
  test(`release metadata: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-btw-release-"));
    try {
      const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      const lock = JSON.parse(
        await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
      );
      if (scenario === "lock mismatch") lock.version = "0.0.0";
      await writeFile(join(root, "package.json"), JSON.stringify(pkg));
      await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
      const heading = `## ${pkg.version} - 2026-11-12`;
      await writeFile(
        join(root, "CHANGELOG.md"),
        [
          "# Changelog",
          "",
          "## Unreleased",
          "",
          scenario === "empty unreleased" ? "" : "- A change for a future release.",
          "",
          heading,
          "",
          scenario === "missing notes" ? "" : "- Existing release notes.",
          "",
          scenario === "duplicate release" ? `${heading}\n\n- Duplicate notes.\n` : "",
        ].join("\n"),
      );
      // Exercise both ordinary CI invocation and the tag-release invocation.
      for (const args of [[], [scenario === "tag mismatch" ? "v0.0.0" : `v${pkg.version}`]]) {
        const result = spawnSync(process.execPath, [script, ...args], {
          cwd: root,
          encoding: "utf8",
        });
        assert.ifError(result.error);
        const valid =
          ["empty unreleased", "pending changes"].includes(scenario) ||
          (scenario === "tag mismatch" && args.length === 0);
        if (valid) assert.equal(result.status, 0, result.stderr);
        else {
          assert.equal(result.status, 1, result.stderr);
          assert.match(result.stderr, /AssertionError/);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

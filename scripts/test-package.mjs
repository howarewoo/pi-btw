import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";

// Adapted from pi-extended-subagents: exercise Pi's actual package loader, not a source import.
const root = await mkdtemp(join(tmpdir(), "pi-btw-packed-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
try {
  const expected = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  let tarball = process.argv[2] && resolve(process.argv[2]);
  if (!tarball) {
    const [packed] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", root], { encoding: "utf8" }));
    tarball = join(root, packed.filename);
  }
  // Inspect real tar headers before installation. Only deliberately shipped source/docs are allowed.
  const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
  for (const entry of entries) {
    assert.ok(!entry.split("/").includes(".."), `Unsafe tar path: ${entry}`);
    assert.match(entry, /^package\/(?:index\.ts|src\/[\w-]+\.ts|docs\/images\/[\w-]+\.svg|package\.json|README\.md|CHANGELOG\.md|LICENSE)$/, `Unexpected packed file: ${entry}`);
  }
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "npmrc"), "");
  execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--legacy-peer-deps", "--omit=dev", "--no-audit", "--no-fund", "--userconfig", join(root, "npmrc"), tarball], { cwd: root, stdio: "inherit" });
  const installed = join(root, "node_modules", ...expected.name.split("/"));
  const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.deepEqual(pkg, expected);
  assert.ok(!pkg.dependencies && !pkg.bundledDependencies && !pkg.bundleDependencies, "Pi supplies all runtime dependencies");
  assert.deepEqual(pkg.pi.extensions, ["./index.ts"]);
  // No host SDK duplicates (or other packages) may appear in the isolated consumer.
  assert.deepEqual((await readdir(join(root, "node_modules"))).sort(), [".package-lock.json", "@howarewoo"]);
  for (const file of ["README.md", "CHANGELOG.md", "LICENSE"])
    assert.ok((await readFile(join(installed, file), "utf8")).trim(), `Missing ${file}`);
  const readme = await readFile(join(installed, "README.md"), "utf8");
  for (const [, target] of readme.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(target)) continue;
    const path = resolve(dirname(join(installed, "README.md")), target.split("#")[0]);
    assert.ok(!relative(installed, path).startsWith(".."), `Escaping README link: ${target}`);
    assert.ok((await readFile(path)).length, `Broken packed README link: ${target}`);
  }
  const { DefaultResourceLoader, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const host = JSON.parse(await readFile(new URL("../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8"));
  assert.equal(host.version, "1.5.2", "Smoke test must exercise the pinned host");
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir: join(root, "agent"),
    settingsManager: SettingsManager.inMemory({ packages: [installed] }),
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const [extension] = loaded.extensions;
  assert.equal(extension.path, join(installed, "index.ts"));
  // Exercise the pinned host's real startup-label renderer with npm source metadata.
  // Import by file URL because this internal renderer is not a public SDK export.
  const { InteractiveMode } = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js", import.meta.url));
  const renderer = Object.create(InteractiveMode.prototype);
  assert.deepEqual(renderer.getCompactExtensionLabels([{
    path: extension.path,
    sourceInfo: { ...extension.sourceInfo, source: `npm:${pkg.name}`, baseDir: installed },
  }]), [pkg.name], "npm startup label must not include an entry-point suffix");
  assert.deepEqual([...extension.commands.keys()], ["btw"]);
  assert.equal(extension.tools.size, 0);
  // Execute a representative command boundary without a model/provider or interactive TUI.
  const notices = [];
  await extension.commands.get("btw").handler("", { mode: "rpc", ui: { notify: (...args) => notices.push(args) } });
  assert.deepEqual(notices, [["/btw requires interactive Pi mode", "error"]]);
  console.log(`Packed ${pkg.name}@${pkg.version}: ${entries.length} allowed files; README links resolve; isolated Pi ${host.version} load and /btw boundary passed. Tarball: ${tarball}`);
} finally {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
}

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const generator = fileURLToPath(new URL("../scripts/generate-changelog.mjs", import.meta.url));
const titleCheck = fileURLToPath(new URL("../scripts/check-pr-title.mjs", import.meta.url));
const original =
  "# Changelog\n\n## [Unreleased]\n\n- Curated #65/#66 notes.\n\n## [0.4.0]\n\nHistorical bytes.\n";

async function fixture(run: (root: string, git: (...args: string[]) => string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "pi-changelog-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.5.0" }));
    await writeFile(join(root, "CHANGELOG.md"), original);
    git("add", ".");
    git("commit", "-m", "old release");
    git("tag", "v0.4.0");
    await run(root, git);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function generate(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [generator, ...args], { cwd: root, encoding: "utf8" });
}

test("generates grouped first-parent notes, breaking guidance and preserved curated/history bytes", async () => {
  await fixture(async (root, git) => {
    git("commit", "--allow-empty", "-m", "feat(hub): add output (#70)");
    git("switch", "-c", "topic");
    git("commit", "--allow-empty", "-m", "feat: branch-only detail");
    git("switch", "main");
    git(
      "merge",
      "--no-ff",
      "topic",
      "-m",
      "fix!: merge behavior (#71)",
      "-m",
      "BREAKING CHANGE: drain tasks first\nthen restart",
    );
    git("commit", "--allow-empty", "-m", "Legacy subject (#72)");
    const preview = generate(root, "--from", "v0.4.0", "--dry-run");
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(await readFile(join(root, "CHANGELOG.md"), "utf8"), original);
    const result = generate(root, "--from", "v0.4.0");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Warning: retaining nonconventional commit/);
    const actual = await readFile(join(root, "CHANGELOG.md"), "utf8");
    assert.equal(actual.replace(preview.stdout, ""), original);
    assert.match(preview.stdout, /### Previously curated notes\n\n- Curated #65\/#66 notes\./);
    assert.match(preview.stdout, /### Breaking changes[\s\S]*drain tasks first\n  then restart/);
    assert.match(
      preview.stdout,
      /### Features\n\n- feat\(hub\): add output \(#70\) \([a-f0-9]{12}\)/,
    );
    assert.match(preview.stdout, /### Fixes and performance/);
    assert.match(preview.stdout, /### Other changes\n\n- Legacy subject \(#72\)/);
    assert.doesNotMatch(preview.stdout, /branch-only|old release/);
    assert.notEqual(generate(root, "--from", "v0.4.0").status, 0);
    assert.equal(await readFile(join(root, "CHANGELOG.md"), "utf8"), actual);
  });
});

test("conventional parser and title command reject malformed titles without executing data", () => {
  for (const type of [
    "feat",
    "fix",
    "perf",
    "refactor",
    "docs",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
    "style",
  ]) {
    assert.equal(
      spawnSync(process.execPath, [titleCheck], {
        env: { ...process.env, PR_TITLE: `${type}(hub)!: change (#1)` },
      }).status,
      0,
    );
  }
  for (const title of [
    "plain",
    "Feat: change",
    "feat(): change",
    "feat: ",
    "feat: change\nfix: another",
    "feat: change\n",
    "feat: change\r",
    "unknown: change",
  ]) {
    assert.notEqual(
      spawnSync(process.execPath, [titleCheck], { env: { ...process.env, PR_TITLE: title } })
        .status,
      0,
    );
  }
  assert.equal(
    spawnSync(process.execPath, [titleCheck], {
      env: { ...process.env, PR_TITLE: "fix: $(exit 1) `exit 1`; # untrusted" },
    }).status,
    0,
  );
});

for (const scenario of [
  "missing argument",
  "missing tag",
  "branch not tag",
  "empty range",
  "nonancestor",
  "shallow",
  "prerelease",
  "duplicate",
  "malformed changelog",
]) {
  test(`generation fails without writes: ${scenario}`, async () => {
    await fixture(async (root, git) => {
      let args = ["--from", "v0.4.0"];
      if (scenario !== "empty range") git("commit", "--allow-empty", "-m", "fix: new behavior");
      if (scenario === "missing argument") args = [];
      if (scenario === "missing tag") args = ["--from", "missing"];
      if (scenario === "branch not tag") args = ["--from", "main"];
      if (scenario === "nonancestor") {
        git("switch", "--orphan", "unrelated");
        git("commit", "--allow-empty", "-m", "unrelated");
        git("tag", "unrelated");
        git("switch", "main");
        args = ["--from", "unrelated"];
      }
      if (scenario === "shallow") {
        await writeFile(join(root, ".git", "shallow"), `${git("rev-parse", "HEAD")}\n`);
      }
      if (scenario === "prerelease") {
        await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.5.0-beta.1" }));
      }
      if (scenario === "duplicate")
        await writeFile(
          join(root, "CHANGELOG.md"),
          `${original}\n## [0.5.0] - reviewed\n\nReviewed.\n`,
        );
      if (scenario === "malformed changelog")
        await writeFile(join(root, "CHANGELOG.md"), "No release headings\n");
      const before = await readFile(join(root, "CHANGELOG.md"), "utf8");
      const result = generate(root, ...args);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /Changelog generation failed/);
      assert.equal(await readFile(join(root, "CHANGELOG.md"), "utf8"), before);
    });
  });
}

test("stable oldest-first order, all types retained, breaking footer independent of type", async () => {
  await fixture(async (root, git) => {
    git(
      "commit",
      "--allow-empty",
      "-m",
      "docs: new contract",
      "-m",
      "BREAKING-CHANGE: migrate settings\ncontinued guidance\n\nRefs: #1",
    );
    git("commit", "--allow-empty", "-m", "feat!: new API");
    git("commit", "--allow-empty", "-m", "perf: faster");
    git("commit", "--allow-empty", "-m", "fix: correct");
    for (const type of ["refactor", "test", "build", "ci", "chore", "revert", "style"])
      git("commit", "--allow-empty", "-m", `${type}: retained`);
    const result = generate(root, "--from", "v0.4.0", "--dry-run");
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /### Breaking changes[\s\S]*docs: new contract[\s\S]*migrate settings[\s\S]*feat!: new API[\s\S]*maintainer must add migration/,
    );
    assert.match(result.stdout, /migrate settings\n  continued guidance/);
    assert.doesNotMatch(result.stdout, /Refs: #1/);
    assert.ok(result.stdout.indexOf("- perf: faster") < result.stdout.indexOf("- fix: correct"));
    for (const type of ["refactor", "test", "build", "ci", "chore", "revert", "style"])
      assert.ok(result.stdout.includes(`${type}: retained`));
    assert.equal(generate(root, "--from", "v0.4.0", "--dry-run").stdout, result.stdout);
  });
});

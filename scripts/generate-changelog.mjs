import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { breakingNotes, parseSubject } from "./conventional-commits.mjs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trimEnd();
}

try {
  const args = process.argv.slice(2);
  const preview = args.at(-1) === "--dry-run";
  if (preview) args.pop();
  assert.ok(
    args.length === 2 && args[0] === "--from" && args[1] && !args[1].startsWith("-"),
    "Usage: npm run changelog:generate -- --from <previous-release-tag> [--dry-run]",
  );
  assert.equal(git("rev-parse", "--is-shallow-repository"), "false", "Fetch full history first");
  // Resolve only an explicit tag, never an ambiguous branch or arbitrary revision expression.
  const ref = `refs/tags/${args[1]}`;
  git("check-ref-format", ref);
  const base = git("rev-parse", "--verify", `${ref}^{commit}`);
  git("merge-base", "--is-ancestor", base, "HEAD");
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Use a stable version");
  const changelog = await readFile("CHANGELOG.md", "utf8");
  assert.ok(
    !new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\](?:\\s|$)`, "m").test(changelog),
    `Changelog already contains ${version}; reviewed notes will not be overwritten`,
  );
  const commits = git("rev-list", "--first-parent", "--reverse", `${base}..HEAD`)
    .split("\n")
    .filter(Boolean);
  assert.ok(commits.length, "No commits since the previous tag");
  const groups = { Features: [], "Fixes and performance": [], "Other changes": [] };
  const breaking = [];
  for (const hash of commits) {
    const subject = git("show", "-s", "--format=%s", hash);
    const body = git("show", "-s", "--format=%b", hash);
    const parsed = parseSubject(subject);
    const notes = breakingNotes(body);
    const reference = `(${hash.slice(0, 12)})`;
    const entry = `- ${subject} ${reference}`;
    const group =
      parsed?.type === "feat"
        ? "Features"
        : ["fix", "perf"].includes(parsed?.type)
          ? "Fixes and performance"
          : "Other changes";
    groups[group].push(entry);
    if (!parsed)
      console.error(`Warning: retaining nonconventional commit ${hash.slice(0, 12)}: ${subject}`);
    if (parsed?.breaking || notes.length) {
      breaking.push(
        `${entry}\n${notes.length ? notes.map((note) => `\n  ${note.replaceAll("\n", "\n  ")}`).join("\n") : "\n  Breaking marker: maintainer must add migration and compatibility guidance."}`,
      );
    }
  }
  const headings = [...changelog.matchAll(/^## .*$/gm)];
  assert.ok(headings.length, "Changelog must contain a release heading");
  const unreleased = headings[0][0] === "## [Unreleased]";
  const insertion = unreleased ? (headings[1]?.index ?? changelog.length) : headings[0].index;
  const curated = unreleased
    ? changelog.slice(headings[0].index + headings[0][0].length, insertion).trim()
    : "";
  const sections = [`## [${version}]`];
  if (curated) sections.push(`### Previously curated notes\n\n${curated}`);
  if (breaking.length) sections.push(`### Breaking changes\n\n${breaking.join("\n")}`);
  for (const [name, entries] of Object.entries(groups)) {
    if (entries.length) sections.push(`### ${name}\n\n${entries.join("\n")}`);
  }
  const section = `${sections.join("\n\n")}\n\n`;
  if (preview) process.stdout.write(section);
  else {
    await writeFile(
      "CHANGELOG.md",
      changelog.slice(0, insertion) + section + changelog.slice(insertion),
    );
    console.log(
      `Generated ${version} from ${args[1]}..HEAD (${commits.length} first-parent commits). Review migration guidance and curated-note duplicates.`,
    );
  }
} catch (error) {
  console.error(`Changelog generation failed: ${error.message}`);
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const tag = process.argv[2] ?? `v${pkg.version}`;
// Stable latest-channel releases only; no implicit prerelease policy.
assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
assert.equal(tag, `v${pkg.version}`, "Release tag must match package.json");
assert.equal(pkg.name, "@howarewoo/pi-btw");
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
for (const key of ["name", "version", "engines", "peerDependencies", "devDependencies"])
  assert.deepEqual(lock.packages[""][key], pkg[key], `Lockfile ${key} must match`);
assert.equal(pkg.publishConfig.access, "public");
assert.equal(pkg.license, "MIT");
const changelog = await readFile("CHANGELOG.md", "utf8");
const sections = [...changelog.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
assert.equal(sections[0]?.[1], "Unreleased");
// Pending changes belong to a future release, not the version being validated.
assert.match(
  sections[1]?.[1] ?? "",
  new RegExp(`^${pkg.version.replaceAll(".", "\\.")} - \\d{4}-\\d{2}-\\d{2}$`),
);
assert.equal(sections.filter((s) => s[1].startsWith(`${pkg.version} - `)).length, 1);
assert.match(sections[1][2], /^- \S/m, "Release notes must contain changes");
console.log(`Release metadata verified: ${tag} (not proof of publication or authentication)`);

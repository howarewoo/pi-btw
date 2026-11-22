import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/release-notes.mjs", import.meta.url));
const publishScript = fileURLToPath(new URL("../scripts/publish-package.mjs", import.meta.url));

for (const scenario of ["valid", "tag mismatch", "lock mismatch", "missing notes", "prerelease"])
  test(`release metadata: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-btw-release-"));
    try {
      const version = scenario === "prerelease" ? "0.2.0-beta.1" : "0.2.0";
      await writeFile(join(root, "package.json"), JSON.stringify({ version, license: "MIT" }));
      await writeFile(
        join(root, "package-lock.json"),
        JSON.stringify({
          version,
          packages: { "": { version: scenario === "lock mismatch" ? "0.1.0" : version } },
        }),
      );
      await writeFile(
        join(root, "CHANGELOG.md"),
        `# Changelog\n\n## [${version}]\n\n${scenario === "missing notes" ? "" : "New release."}\n\n## [0.1.0]\n\nOld notes.\n`,
      );
      const output = join(root, "notes.md");
      const result = spawnSync(
        process.execPath,
        [script, scenario === "tag mismatch" ? "v0.3.0" : `v${version}`, output],
        { cwd: root, encoding: "utf8" },
      );
      if (scenario === "valid") {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await readFile(output, "utf8"), "New release.\n");
      } else {
        assert.notEqual(result.status, 0, "Invalid release must be rejected");
        assert.match(result.stderr, /AssertionError/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

for (const scenario of [
  "new",
  "identical",
  "different",
  "registry error",
  "missing tarball",
  "changed tarball",
  "missing metadata",
  "wrong name",
  "wrong version",
  "wrong tag",
  "wrong commit",
  "wrong path",
  "wrong digest",
  "verify only",
  "missing oidc",
  "stored token",
  "old npm",
])
  test(`publication recovery: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-btw-publish-"));
    try {
      const tarball = join(root, "release.tgz");
      await writeFile(tarball, "controlled tarball bytes");
      const integrity = `sha512-${createHash("sha512").update("controlled tarball bytes").digest("base64")}`;
      const metadata = {
        name: "@howarewoo/pi-btw",
        version: "0.1.1",
        tag: "v0.1.1",
        commit: "a".repeat(40),
        tarball: "release.tgz",
        integrity,
      };
      if (scenario === "missing tarball") await rm(tarball);
      if (scenario === "changed tarball") await writeFile(tarball, "changed");
      const fields = {
        "wrong name": "name",
        "wrong version": "version",
        "wrong tag": "tag",
        "wrong commit": "commit",
        "wrong path": "tarball",
        "wrong digest": "integrity",
      } as const;
      if (scenario in fields) metadata[fields[scenario as keyof typeof fields]] = "wrong";
      if (scenario !== "missing metadata")
        await writeFile(join(root, "metadata.json"), JSON.stringify(metadata));
      // Replace network and process publication in the subprocess, never contact npm or publish.
      const preload = `
        import assert from "node:assert/strict";
        import childProcess from "node:child_process";
        import { syncBuiltinESMExports } from "node:module";
        childProcess.execFileSync = (command, args) => {
          if (args[0] === "--version") return ${JSON.stringify(scenario === "old npm" ? "11.5.0\n" : "11.5.1\n")};
          assert.equal(${JSON.stringify(scenario)}, "new", "Existing versions must not publish");
          assert.equal(command, "npm");
          assert.deepEqual(args, ["publish", ${JSON.stringify(tarball)}, "--access", "public", "--ignore-scripts"]);
          console.log("CONTROLLED_PUBLISH");
        };
        syncBuiltinESMExports();
        globalThis.fetch = async url => {
          console.log("CONTROLLED_FETCH");
          assert.ok(["new", "identical", "different", "registry error"].includes(${JSON.stringify(scenario)}), "Invalid artifact must fail before network access");
          assert.equal(url, "https://registry.npmjs.org/%40howarewoo%2Fpi-btw/0.1.1");
          return {
            status: ${scenario === "new" ? 404 : scenario === "registry error" ? 503 : 200},
            json: async () => ({dist: {integrity: ${JSON.stringify(scenario === "different" ? "sha512-different" : integrity)}}})
          };
        };
      `;
      // Controlled OIDC context only; stored npm tokens are never inherited by the subprocess.
      const { NPM_TOKEN: _npm, NODE_AUTH_TOKEN: _node, ...env } = process.env;
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          `data:text/javascript,${encodeURIComponent(preload)}`,
          publishScript,
          root,
          ...(scenario === "verify only" ? ["--verify-only"] : []),
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...env,
            ...(scenario === "missing oidc"
              ? {}
              : {
                  ACTIONS_ID_TOKEN_REQUEST_URL: "https://controlled.invalid/oidc",
                  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "controlled",
                }),
            ...(scenario === "stored token" ? { NPM_TOKEN: "controlled" } : {}),
            RELEASE_TAG: "v0.1.1",
            RELEASE_COMMIT: "a".repeat(40),
            RELEASE_INTEGRITY: integrity,
          },
        },
      );
      assert.equal(
        result.status,
        ["new", "identical", "verify only"].includes(scenario) ? 0 : 1,
        result.stderr,
      );
      assert.equal(result.stdout.includes("CONTROLLED_PUBLISH"), scenario === "new");
      assert.equal(
        result.stdout.includes("CONTROLLED_FETCH"),
        ["new", "identical", "different", "registry error"].includes(scenario),
      );
      if (scenario === "different") assert.match(result.stderr, /different contents/);
      if (scenario === "registry error") assert.match(result.stderr, /Cannot verify/);
      if (scenario === "verify only") assert.match(result.stdout, /no registry access/);
      if (scenario === "missing oidc") assert.match(result.stderr, /OIDC context required/);
      if (scenario === "stored token") assert.match(result.stderr, /tokens are not allowed/);
      if (scenario === "old npm") assert.match(result.stderr, /npm >=11\.5\.1/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

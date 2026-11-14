import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { repoRoot, parseFrontmatter } from "@l2/agent-core";

const root = repoRoot();
const out = await mkdtemp(path.join(tmpdir(), "dist-"));
const result = spawnSync(process.execPath, [path.join(root, "scripts/package.js"), "--out", out, "--ref", "v9.9.9"], { cwd: root, encoding: "utf8" });
const market = path.join(out, "marketplace");
const json = async (p) => JSON.parse(await readFile(p, "utf8"));

test("package exits cleanly", () => assert.equal(result.status, 0, result.stderr));

test("generated plugin READMEs match marketplace config and explain agent setup", async () => {
  // Arrange
  const config = await json(path.join(root, "bundles.json"));
  const published = config.bundles.filter((bundle) => bundle.status === "published");

  // Act
  const readmes = await Promise.all(published.map(async (bundle) => ({
    bundle,
    content: await readFile(path.join(market, "plugins", bundle.name, "README.md"), "utf8"),
  })));

  // Assert
  for (const { bundle, content } of readmes) {
    assert.ok(content.includes(`copilot plugin marketplace add ${config.marketplace.repository}`), bundle.name);
    if (bundle.agents.length) {
      assert.match(content, /## Use the agents/);
      assert.match(content, /agent picker/);
    }
    if (bundle.instructions.length) {
      assert.match(content, /## Configure repository instructions/);
      assert.match(content, /does not apply them automatically/);
      assert.match(content, /applyTo/);
    }
  }

  const delivery = readmes.find(({ bundle }) => bundle.name === "sdlc-delivery").content;
  const modernization = readmes.find(({ bundle }) => bundle.name === "sdlc-modernization").content;
  const finops = readmes.find(({ bundle }) => bundle.name === "copilot-finops").content;
  assert.match(delivery, /WORK_ITEM_PROVIDER/);
  assert.match(modernization, /L2_PLATFORM_ROOT/);
  assert.match(finops, /COPILOT_ORG/);
  assert.match(finops, /not the scheduled L2 monitor/);
});

test("marketplace lists published bundles only, every path resolves, no pinned models", async () => {
  const mk = await json(path.join(market, ".github/plugin/marketplace.json"));
  const published = (await json(path.join(root, "bundles.json"))).bundles.filter((b) => b.status === "published").map((b) => b.name);
  assert.deepEqual(mk.plugins.map((p) => p.name), published);
  for (const name of await readdir(path.join(market, "plugins"))) {
    const dir = path.join(market, "plugins", name);
    const m = await json(path.join(dir, ".github/plugin/plugin.json"));
    for (const p of [...(m.agents ?? []), ...(m.skills ?? []), ...(m.hooks ? [m.hooks] : [])]) assert.ok(existsSync(path.join(dir, p)), `${name}: ${p}`);
    for (const a of m.agents ?? []) assert.equal(parseFrontmatter(await readFile(path.join(dir, a), "utf8")).data.model, undefined);
  }
});

test("sdlc-delivery plugin ships the work-items CLI and setup guide", async () => {
  const dir = path.join(market, "plugins/sdlc-delivery/skills/work-items");
  assert.ok(existsSync(path.join(dir, "scripts/wi.mjs")));
  assert.ok(existsSync(path.join(dir, "references/setup.md")));
  const r = spawnSync(process.execPath, [path.join(dir, "scripts/wi.mjs"), "doctor"], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(r.status, 0, r.stderr);
});

test("packaged hooks use PLUGIN_ROOT and actually run", async () => {
  // Arrange
  const dir = path.join(market, "plugins/l2-guardrails");
  const entry = (await json(path.join(dir, "hooks/hooks.json"))).hooks.preToolUse[0];
  const windows = process.platform === "win32";
  // Act
  const r = spawnSync(windows ? "powershell" : "bash", windows ? ["-NoProfile", "-Command", entry.powershell] : ["-c", entry.bash], { input: JSON.stringify({ toolName: "bash", toolArgs: JSON.stringify({ command: "git push --force" }) }), encoding: "utf8", env: { ...process.env, PLUGIN_ROOT: dir }, cwd: tmpdir() });
  // Assert
  assert.match(entry.bash, /\$\{PLUGIN_ROOT\}\/hooks\/scripts\/guard-tool-use\.mjs/);
  assert.match(entry.powershell, /\$env:PLUGIN_ROOT\/hooks\/scripts\/guard-tool-use\.mjs/);
  const shell = windows ? "powershell" : "bash";
  const args = windows ? ["-NoProfile", "-Command", entry.powershell] : ["-c", entry.bash];
  // Act
  const execution = spawnSync(shell, args, { input: JSON.stringify({ toolName: "bash", toolArgs: JSON.stringify({ command: "git push --force" }) }), encoding: "utf8", env: { ...process.env, PLUGIN_ROOT: dir }, cwd: tmpdir() });
  // Assert
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /"permissionDecision":"deny"/);
});

test("org workflow templates pinned, including TaskSync", async () => {
  const dir = path.join(out, "org-workflow-templates/workflow-templates");
  for (const id of ["testgen", "codeconnect", "tasksync", "finops"]) assert.ok(existsSync(path.join(dir, `l2-${id}.yml`)), id);
  assert.match(await readFile(path.join(dir, "l2-tasksync.yml"), "utf8"), /_agent-node-reusable\.yml@v9\.9\.9/);
});

test("modernization plugin ships both agents and a launcher but no legacy state", async () => {
  // Arrange
  const dir = path.join(market, "plugins/sdlc-modernization");
  // Act
  const manifest = await json(path.join(dir, ".github/plugin/plugin.json"));
  // Assert
  assert.deepEqual(manifest.agents, ["./agents/modplanner.agent.md", "./agents/fsd-agent.agent.md"]);
  assert.ok(existsSync(path.join(dir, "skills/l2-platform-runner/scripts/run.mjs")));
  assert.equal(existsSync(path.join(dir, "agents/node")), false);
  assert.equal(existsSync(path.join(dir, "docs/migration-archive")), false);
  assert.equal(existsSync(path.join(dir, ".env.local")), false);
});

test("planning workflow templates use the stateful reusable workflow", async () => {
  // Arrange
  const dir = path.join(out, "org-workflow-templates/workflow-templates");
  // Act
  const templates = await Promise.all(["modplanner", "requirementshub"].map((id) => readFile(path.join(dir, `l2-${id}.yml`), "utf8")));
  // Assert
  assert.ok(templates.every((content) => content.includes("_agent-planning-reusable.yml@v9.9.9")));
  assert.ok(templates.every((content) => content.includes("platform-ref: v9.9.9")));
});

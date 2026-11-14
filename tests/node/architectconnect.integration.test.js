import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadBinding, parseFrontmatter } from "@l2/agent-core";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entrypoint = path.join(root, "agents/node/architectconnect/src/index.js");

test("ArchitectConnect binding resolves the discoverable named agent with both output modes", async () => {
  // Arrange
  const definition = await readFile(path.join(root, ".github/agents/architectconnect.agent.md"), "utf8");
  // Act
  const binding = await loadBinding("architectconnect", { root });
  // Assert
  assert.equal(binding.manifest.agent, ".github/agents/architectconnect.agent.md");
  assert.equal(parseFrontmatter(definition).data.name, "architectconnect");
  assert.match(definition, /"mode": "automation"/);
  assert.match(definition, /\*\*Chat:\*\*/);
});

async function fixture(context) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "l2-architectconnect-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, "source");
  await mkdir(source);
  await writeFile(path.join(source, "package.json"), JSON.stringify({ name: "fixture", dependencies: { express: "4" } }));
  await writeFile(path.join(source, "app.js"), 'import express from "express"; const app = express(); app.get("/users", listUsers);');
  await writeFile(path.join(source, ".env.local"), "IGNORE_THIS_FIXTURE_SENTINEL=not-a-secret\n");
  return { workspace, source };
}

function invoke(script, args, workspace, extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: workspace, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, AGENT_RUNTIME: "mock", AGENT_DRY_RUN: "false", L2_AUDIT_LOG: path.join(workspace, "audit.jsonl"), ...extraEnv },
  });
}

test("ArchitectConnect CLI runs from another cwd without reading credentials or writing dry-run reports", async (context) => {
  // Arrange
  const { workspace, source } = await fixture(context);
  // Act
  const execution = invoke(entrypoint, ["--local", source, "--workspace", workspace, "--validate"], workspace);
  // Assert
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.status, "succeeded");
  assert.equal(result.metrics.model, null);
  assert.equal(result.data.validation.saved, false);
  assert.equal(result.data.validation.mermaidGrammar, "valid");
  assert.doesNotMatch(execution.stdout, /IGNORE_THIS_FIXTURE_SENTINEL/);
  assert.equal((await readdir(workspace)).includes("docs"), false);
});

test("ArchitectConnect CLI saves requested artifacts and refuses to overwrite them on a repeated run", async (context) => {
  // Arrange
  const { workspace, source } = await fixture(context);
  const args = ["--local", source, "--workspace", workspace, "--apply"];
  const first = invoke(entrypoint, args, workspace);
  assert.equal(first.status, 0, first.stderr);
  const report = path.join(workspace, "docs/hld/architectconnect/ArchitectureReport.md");
  const original = await readFile(report, "utf8");
  // Act
  const repeated = invoke(entrypoint, args, workspace);
  // Assert
  assert.equal(repeated.status, 1);
  assert.equal(JSON.parse(repeated.stdout).status, "failed");
  assert.equal(await readFile(report, "utf8"), original);
  assert.equal(JSON.parse(first.stdout).data.validation.saved, true);
  assert.ok((await readFile(path.join(workspace, "docs/hld/architectconnect/architecture.dsl"), "utf8")).trim());
  assert.ok(Array.isArray(JSON.parse(await readFile(path.join(workspace, "docs/hld/architectconnect/ArchitectureDecisions.json"), "utf8"))));
});

test("draft design packaging ships an ArchitectConnect launcher that resolves a configured platform checkout", async (context) => {
  // Arrange
  const { workspace, source } = await fixture(context);
  const out = path.join(workspace, "package-output");
  const packaged = invoke(path.join(root, "scripts/package.js"), ["--include-drafts", "--out", out], workspace, { L2_ROOT: root });
  assert.equal(packaged.status, 0, packaged.stderr);
  const launcher = path.join(out, "marketplace/plugins/sdlc-design/skills/architectconnect/scripts/run.mjs");
  // Act
  const execution = invoke(launcher, ["--local", source], workspace, { L2_PLATFORM_ROOT: root });
  // Assert
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(JSON.parse(execution.stdout).status, "succeeded");
  assert.equal(JSON.parse(execution.stdout).data.validation.saved, false);
  const pluginDirectory = path.join(out, "marketplace/plugins/sdlc-design");
  const manifest = JSON.parse(await readFile(path.join(pluginDirectory, ".github/plugin/plugin.json"), "utf8"));
  assert.ok(manifest.agents.includes("./agents/architectconnect.agent.md"));
  assert.equal(await readFile(path.join(pluginDirectory, "agents/architectconnect.agent.md"), "utf8"), await readFile(path.join(root, ".github/agents/architectconnect.agent.md"), "utf8"));
});

test("strict diagram validation refuses persistence when Structurizr is unavailable", async (context) => {
  // Arrange
  const { workspace, source } = await fixture(context);
  const args = ["--local", source, "--workspace", workspace, "--apply", "--require-validated"];
  // Act
  const execution = invoke(entrypoint, args, workspace, { STRUCTURIZR_WAR: "" });
  // Assert
  assert.equal(execution.status, 1);
  assert.match(JSON.parse(execution.stdout).summary, /Both diagram grammars must be validated/);
  assert.equal((await readdir(workspace)).includes("docs"), false);
});

test("source-only isolated platform runs migrated tests and CLI without legacy folders or original workspace links", async (context) => {
  // Arrange
  const { workspace, source } = await fixture(context);
  const isolated = path.join(workspace, "isolated-platform");
  await mkdir(isolated);
  const roots = ["package.json", "packages/node", "agents/node", ".github", "l2", "configurations", "tests/unit/agents/node/architectconnect", "bundles.json"];
  if (existsSync(path.join(root, "package-lock.json"))) roots.push("package-lock.json");
  for (const relative of roots) {
    await cp(path.join(root, relative), path.join(isolated, relative), {
      recursive: true,
      filter: async (filePath) => !/(^|[\\/])(node_modules|\.git|dist|build|\.env(?:\.[^\\/]*)?|credentials?(?:\.[^\\/]*)?|secrets?(?:\.[^\\/]*)?|id_rsa[^\\/]*|id_ed25519[^\\/]*)([\\/]|$)|\.(pem|key|pfx|p12)$/i.test(filePath) && !(await lstat(filePath)).isSymbolicLink(),
    });
  }
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const installed = invoke(npmCli, [existsSync(path.join(isolated, "package-lock.json")) ? "ci" : "install", "--offline", "--ignore-scripts"], isolated, { L2_ROOT: isolated, GITHUB_WORKSPACE: isolated });
  assert.equal(installed.status, 0, installed.stderr);
  const unit = spawnSync(process.execPath, ["--test", "tests/unit/agents/node/architectconnect/**/*.test.js"], { cwd: isolated, encoding: "utf8", env: { ...process.env, L2_ROOT: isolated, GITHUB_WORKSPACE: isolated } });
  assert.equal(unit.status, 0, unit.stderr + unit.stdout);
  // Act
  const execution = invoke(path.join(isolated, "agents/node/architectconnect/src/index.js"), ["--local", source, "--workspace", workspace, "--validate"], workspace, { L2_ROOT: isolated, GITHUB_WORKSPACE: isolated, STRUCTURIZR_WAR: "" });
  // Assert
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(JSON.parse(execution.stdout).data.validation.mermaidGrammar, "valid");
  assert.equal(existsSync(path.join(isolated, "Architect Connect")), false);
  assert.equal(existsSync(path.join(isolated, "scm-bridge-clone")), false);
  assert.equal(await realpath(path.join(isolated, "node_modules/@l2/agent-core")), await realpath(path.join(isolated, "packages/node/agent-core")));
});
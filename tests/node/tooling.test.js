import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtemp, readFile, cp, writeFile, mkdir, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { repoRoot, toRemoteWorkflow } from "@l2/agent-core";

const root = repoRoot();
const run = (script, args = [], { env = {}, cwd = root } = {}) => spawnSync(process.execPath, [path.join(root, script), ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

test("validate: no errors", () => {
  const r = run("scripts/validate.js");
  assert.equal(r.status, 0, r.stdout);
});

test("validate: flags pinned model, missing automation contract, broken bundle", async () => {
  const copy = await mkdtemp(path.join(tmpdir(), "val-"));
  for (const d of [".github", "l2", "configurations", "agents", "evals"]) await cp(path.join(root, d), path.join(copy, d), { recursive: true });
  await cp(path.join(root, "package.json"), path.join(copy, "package.json"));
  await writeFile(path.join(copy, ".github/agents/bad.agent.md"), "---\nname: bad\ndescription: 'A bad agent for the validator.'\nmodel: gpt-4o\ntools: ['read']\n---\n\n" + "Return only JSON. ".repeat(12));
  const bundles = JSON.parse(await readFile(path.join(root, "bundles.json"), "utf8"));
  bundles.bundles[0].agents.push("ghost-agent");
  await writeFile(path.join(copy, "bundles.json"), JSON.stringify(bundles));
  const r = run("scripts/validate.js", [], { env: { L2_ROOT: copy } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /pins the chat user's model/);
  assert.match(r.stdout, /Automation branch/);
  assert.match(r.stdout, /agent not found: ghost-agent/);
});

test("eval passes offline", () => assert.equal(run("scripts/eval.js", [], { env: { AGENT_RUNTIME: "mock" } }).status, 0));

test("wi.mjs CLI: doctor never prints secrets; missing config is a clean error", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "cli-"));
  const env = { ADO_ORG_URL: "https://dev.azure.com/x", ADO_PROJECT: "P", ADO_PAT: "super-secret-pat-value", JIRA_API_TOKEN: "another-secret", WORK_ITEM_PROVIDER: "ado" };
  const doctor = run(".github/skills/work-items/scripts/wi.mjs", ["doctor"], { env, cwd });
  assert.equal(doctor.status, 0);
  assert.ok(!doctor.stdout.includes("secret"));
  assert.equal(JSON.parse(doctor.stdout).ado.pat, "set");
  const missing = run(".github/skills/work-items/scripts/wi.mjs", ["get", "jira:LEND-1"], { env: { JIRA_BASE_URL: "", JIRA_EMAIL: "", JIRA_API_TOKEN: "", JIRA_PAT: "" }, cwd });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing configuration/);
});

test("create-agent: --work-items adds execute tool, skill and bundle entry", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "scaffold-"));
  await cp(path.join(root, "bundles.json"), path.join(target, "bundles.json"));
  const r = run("scripts/create-agent.js", ["--name", "story-review", "--root", target, "--bundle", "sdlc-delivery", "--work-items"]);
  assert.equal(r.status, 0, r.stderr);
  const agent = await readFile(path.join(target, ".github/agents/story-review-agent.agent.md"), "utf8");
  assert.match(agent, /tools: \['read', 'search', 'execute'\]/);
  assert.ok(!/^model:/m.test(agent));
  assert.deepEqual(JSON.parse(await readFile(path.join(target, "l2/story-review.json"), "utf8")).skills, ["work-items"]);
  assert.equal(run("scripts/create-agent.js", ["--name", "story-review", "--root", target]).status, 1);
  assert.ok(existsSync(path.join(target, "tests/node/story-review.test.js")));
});

test("catalog deterministic; toRemoteWorkflow pins ref", async () => {
  execFileSync(process.execPath, [path.join(root, "scripts/build-catalog.js")], { cwd: root });
  const a = await readFile(path.join(root, "docs/CATALOG.md"), "utf8");
  execFileSync(process.execPath, [path.join(root, "scripts/build-catalog.js")], { cwd: root });
  assert.equal(await readFile(path.join(root, "docs/CATALOG.md"), "utf8"), a);
  const out = toRemoteWorkflow("jobs:\n  t:\n    uses: ./.github/workflows/_agent-node-reusable.yml\n    with:\n      agent: x\n", "org/p", "v1.3.0");
  assert.match(out, /org\/p\/\.github\/workflows\/_agent-node-reusable\.yml@v1\.3\.0/);
  assert.match(out, /platform-ref: v1\.3\.0/);
});

async function planningCheckout() {
  const directory = await mkdtemp(path.join(tmpdir(), "planning-"));
  const platform = path.join(directory, "platform");
  const application = path.join(directory, "application");
  await mkdir(application, { recursive: true });
  for (const name of [".github", "l2", "configurations", "agents", "packages", "docs/migration-archive"]) await cp(path.join(root, name), path.join(platform, name), { recursive: true });
  await cp(path.join(root, "package.json"), path.join(platform, "package.json"));
  await symlink(path.join(root, "node_modules"), path.join(platform, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const env = { ...process.env, L2_ROOT: platform, L2_PLATFORM_ROOT: platform, APPLICATION_WORKSPACE: application,
    L2_ENV_FILE: path.join(directory, "no-credentials"), L2_AUDIT_LOG: path.join(directory, "audit.jsonl"),
    AGENT_RUNTIME: "mock", AGENT_DRY_RUN: "false", GITHUB_EVENT_PATH: "", EVENT_FILE: "", TARGET_REPO: "", GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" };
  const invoke = (id, args, options = {}) => spawnSync(process.execPath, [path.join(platform, "agents/node", id, "src/index.js"), ...args], { cwd: application, env, encoding: "utf8", ...options });
  return { platform, application, env, invoke };
}

test("ModPlanner root CLI, package entry and launcher work without legacy folders", async () => {
  // Arrange
  const fixture = await planningCheckout();
  await cp(path.join(root, "evals/modplanner/valid-plan.json"), path.join(fixture.application, "reply.json"));
  // Act
  const plan = fixture.invoke("modplanner", ["plan", "--run-id", "smoke", "--mock-output", "reply.json"]);
  const preview = fixture.invoke("modplanner", ["preview", "--run-id", "smoke", "--project", "APP"]);
  const unapproved = fixture.invoke("modplanner", ["create", "--run-id", "smoke", "--project", "APP"]);
  const packageEntry = spawnSync(process.execPath, ["src/index.js", "preview", "--run-id", "smoke", "--project", "APP"], { cwd: path.join(fixture.platform, "agents/node/modplanner"), env: fixture.env, encoding: "utf8" });
  const launcher = spawnSync(process.execPath, [path.join(fixture.platform, ".github/skills/l2-platform-runner/scripts/run.mjs"), "modplanner", "preview", "--run-id", "smoke", "--project", "APP"], { cwd: fixture.application, env: fixture.env, encoding: "utf8" });
  // Assert
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(unapproved.status, 1);
  assert.equal(packageEntry.status, 0, packageEntry.stdout + packageEntry.stderr);
  assert.equal(launcher.status, 0, launcher.stdout + launcher.stderr);
  assert.equal(existsSync(path.join(fixture.platform, "mod-agents")), false);
  assert.equal(existsSync(path.join(fixture.platform, "RequirementsHub")), false);
  const saved = JSON.parse(await readFile(path.join(fixture.application, ".l2/modplanner/smoke/preview.json"), "utf8"));
  assert.equal(saved.epic.type, "Epic");
  assert.equal(saved.stories[0].type, "Story");
});

test("RequirementsHub CLI generates and finalizes from offline fixtures", async () => {
  // Arrange
  const fixture = await planningCheckout();
  await cp(path.join(root, "evals/requirementshub/valid-fsd.json"), path.join(fixture.application, "source.json"));
  await writeFile(path.join(fixture.application, "answers.json"), JSON.stringify([{ questionId: "Q1", answer: "Two approval levels", confirmed: true }]));
  // Act
  const generated = fixture.invoke("requirementshub", ["generate", "--epic", "APP-1", "--mock-output", "source.json", "--mock-source", "source.json"]);
  const finalized = fixture.invoke("requirementshub", ["finalize", "--epic", "APP-1", "--answers", "answers.json"]);
  // Assert
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  assert.equal(finalized.status, 0, finalized.stdout + finalized.stderr);
  const directory = path.join(fixture.application, ".l2/requirementshub/APP-1");
  const draft = await readFile(path.join(directory, "FSD-APP-1.md"), "utf8");
  const final = await readFile(path.join(directory, "FSD-APP-1-final.md"), "utf8");
  assert.match(draft, /Q1\. How many levels/);
  assert.match(final, /Two approval levels/);
  assert.equal(final.split("## Traceability Matrix")[1], draft.split("## Traceability Matrix")[1]);
});

test("archived outputs match the original bytes", async () => {
  // Arrange
  const pairs = [
    ["mod-agents/modPlanner/output/migration-plan.json", "modplanner/migration-plan.json"],
    ["mod-agents/modPlanner/output/jira-created.json", "modplanner/jira-created.json"],
    ["RequirementsHub/FSD-KAN-4.md", "requirementshub/FSD-KAN-4.md"],
    ["RequirementsHub/FSD-KAN-8.md", "requirementshub/FSD-KAN-8.md"],
    ["RequirementsHub/FSD-KAN-14.md", "requirementshub/FSD-KAN-14.md"],
    ["RequirementsHub/FSD-KAN-14-final.md", "requirementshub/FSD-KAN-14-final.md"],
  ];
  const expected = ["44f4f3e5619e7a250c8b69a6de6797767e53153d3e18a13f342a319d372c2724", "8d48428a8b9fa40d3055848fe16f6734f04887844ba16eb69cd2243346c4fb4e", "39812af54c9d57daaac32de334c33c144629fa116c294a807f14018401aa6380", "dd938375af477e1375c8cc8a0120aaa303c20e90c62b7cf00138a48045bdd933", "8d5b8cdfb9d8d88f892368bea1e05a3d05dc4b0aceda9583cf43c3d2205cd910", "1fdc2b0a41f073215144239f54912ac9177e79e61400cea5551b089465c2f4e8"];
  // Act
  const hashes = await Promise.all(pairs.map(async ([original, archived]) => {
    const bytes = await readFile(path.join(root, "docs/migration-archive", archived));
    if (existsSync(path.join(root, original))) assert.deepEqual(bytes, await readFile(path.join(root, original)));
    return createHash("sha256").update(bytes).digest("hex");
  }));
  // Assert
  assert.deepEqual(hashes, expected);
});

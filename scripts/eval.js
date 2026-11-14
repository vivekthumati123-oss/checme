#!/usr/bin/env node
/**
 * Golden-case evals. Offline replay by default; AGENT_RUNTIME=copilot runs the same cases live.
 * Every case also checks automation mode and the recorded model.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadBinding, repoRoot, Logger, PolicyEngine, HookRunner, Telemetry, createAgentRequest, matchesGlob } from "@l2/agent-core";
import { InMemoryScmProvider } from "@l2/github-adapter";
import { MockAgentRuntime, CopilotAgentRuntime } from "@l2/copilot-runtime";

import { TestGenAgent } from "../agents/node/testgen/src/testgen-agent.js";
import { ModPlannerAgent } from "../agents/node/modplanner/src/modplanner-agent.js";
import { RequirementsHubAgent } from "../agents/node/requirementshub/src/requirementshub-agent.js";
import { memoryArtifacts } from "../tests/node/helpers.js";

import { ArchitectConnectAgent } from "../agents/node/architectconnect/src/architectconnect-agent.js";

const FACTORIES = {
  testgen: (binding) => new TestGenAgent(binding),
  modplanner: (binding) => new ModPlannerAgent(binding),
  requirementshub: (binding) => new RequirementsHubAgent(binding),
  architectconnect: (binding) => new ArchitectConnectAgent(binding),
};
const args = process.argv.slice(2);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const live = process.env.AGENT_RUNTIME === "copilot";
const root = repoRoot();
process.env.L2_AUDIT_LOG ??= path.join(root, ".l2", "eval-audit.jsonl");
const silent = new Logger({ level: "error", sink: () => {} });

async function runCase(binding, testCase) {
  if (binding.id !== "testgen") return runPlanningCase(binding, testCase);
  const scm = new InMemoryScmProvider({
    pullRequest: { number: 1, title: "eval", baseBranch: "main", headBranch: "feature", baseSha: "base", headSha: "head", author: "eval", labels: [], ...testCase.input.pullRequest },
    changedFiles: testCase.input.changedFiles,
    files: testCase.input.files,
  });
  const runtime = live && binding.id !== "architectconnect" ? new CopilotAgentRuntime() : MockAgentRuntime.replay(testCase.replay ?? {});
  const recorder = { calls: [], run: async (o) => { recorder.calls.push(o); return runtime.run(o); } };
  const request = createAgentRequest({
    agentId: binding.id,
    trigger: { type: "pull_request", provider: "github", eventName: "pull_request", eventAction: "opened" },
    repository: { provider: "github", owner: "eval", name: "eval", defaultBranch: "main", workingDirectory: root, pullRequestNumber: scm.pullRequest.number, headSha: scm.pullRequest.headSha },
    payload: binding.resolveConfig(binding.id === "architectconnect" ? testCase.input.payload : { pullRequestNumber: scm.pullRequest.number }),
    dryRun: binding.id === "architectconnect",
  });
  const context = {
    logger: silent, telemetry: new Telemetry(silent), policy: new PolicyEngine(binding.policy),
    hooks: await HookRunner.load(root, { names: binding.hookNames, context: { agentId: binding.id, source: "eval" } }),
    scm, runtime: recorder, workspace: root,
  };
  return { result: await FACTORIES[binding.id](binding).execute(request, context), calls: recorder.calls };
}

async function runPlanningCase(binding, testCase) {
  const runtime = live ? new CopilotAgentRuntime() : MockAgentRuntime.replay(testCase.replay);
  const calls = [];
  let workItemWrites = 0;
  const context = {
    logger: silent, policy: new PolicyEngine(binding.policy), workspace: root,
    hooks: await HookRunner.load(root, { names: binding.hookNames, context: { agentId: binding.id, source: "eval" } }),
    artifacts: memoryArtifacts(testCase.input.files), scopeArtifacts: memoryArtifacts(), legacyIndex: { modplanner: [] },
    runtime: { async run(options) { calls.push(options); return runtime.run(options); } },
    workItems: {
      async getWorkItem() { return testCase.input.epic; },
      async getEpicChildren() { return testCase.input.children ?? []; },
      async searchAll() { return []; },
      async createWorkItem() { workItemWrites += 1; throw new Error("Eval attempted a forbidden live write"); },
    },
  };
  const request = createAgentRequest({ agentId: binding.id, dryRun: testCase.input.dryRun ?? true, payload: binding.resolveConfig(testCase.input.payload) });
  return { result: await FACTORIES[binding.id](binding).execute(request, context), calls, workItemWrites };
}

function check(binding, testCase, { result, calls, workItemWrites }) {
  const e = testCase.expect;
  const failures = [];
  const fail = (m) => failures.push(m);
  const accepted = result.artifacts.filter((a) => a.type === "file").map((a) => a.path);
  const blocked = result.warnings.filter((w) => w.startsWith("Blocked ")).map((w) => w.slice(8).split(": ")[0]);
  const included = result.data?.prompt?.included ?? [];
  for (const call of calls) {
    let mode = null;
    try { mode = JSON.parse(call.userPrompt).mode; } catch { /* not JSON */ }
    if (mode !== "automation") fail('user prompt must carry "mode": "automation"');
    if ((call.model ?? null) !== binding.model) fail(`model ${call.model}, expected runtime.model ${binding.model}`);
  }
  if (calls.length && !live && result.metrics.model !== `mock:${binding.model ?? "sdk-default"}`) fail(`metrics.model ${result.metrics.model}`);
  if (e.status && result.status !== e.status) fail(`status ${result.status}, expected ${e.status} (${result.summary})`);
  if (e.framework && result.data?.framework !== e.framework) fail(`framework ${result.data?.framework}, expected ${e.framework}`);
  if (e.selectionSource && result.data?.selection?.source !== e.selectionSource) fail(`selection source must be ${e.selectionSource}`);
  if (e.fallbackUsed !== undefined && result.data?.selection?.fallbackUsed !== e.fallbackUsed) fail(`fallbackUsed must be ${e.fallbackUsed}`);
  if (e.saved !== undefined && result.data?.validation?.saved !== e.saved) fail(`saved must be ${e.saved}`);
  if (e.validationWarning && !result.warnings.some((warning) => new RegExp(e.validationWarning).test(warning))) fail("missing artifact validation warning");
  for (const language of e.languages ?? []) if (!result.data?.findings?.languages.includes(language)) fail(`missing language evidence: ${language}`);
  for (const pattern of e.dataMustNotMatch ?? []) if (new RegExp(pattern).test(JSON.stringify(result.data))) fail(`structured data must not match /${pattern}/`);
  if (e.minTestsGenerated && (result.metrics.testsGenerated ?? 0) < e.minTestsGenerated) fail(`testsGenerated ${result.metrics.testsGenerated}`);
  if (e.runtimeCalls !== undefined && calls.length !== e.runtimeCalls) fail(`runtime called ${calls.length} time(s), expected ${e.runtimeCalls}`);
  if (e.workItemWrites !== undefined && workItemWrites !== e.workItemWrites) fail(`work-item writes ${workItemWrites}, expected ${e.workItemWrites}`);
  if (e.requirementCount !== undefined && result.data?.requirementCount !== e.requirementCount) fail(`requirement count ${result.data?.requirementCount}`);
  if (e.planModuleCount !== undefined && result.data?.plan?.modules.length !== e.planModuleCount) fail(`plan module count ${result.data?.plan?.modules.length}`);
  for (const id of e.promptIncludes ?? []) if (!included.includes(id)) fail(`prompt missing ${id}`);
  for (const id of e.promptExcludes ?? []) if (included.includes(id)) fail(`prompt should not include ${id}`);
  for (const p of accepted) if (e.acceptedPathsMatch && !e.acceptedPathsMatch.some((g) => matchesGlob(g, p))) fail(`accepted path ${p} outside ${e.acceptedPathsMatch}`);
  if (!live) {
    if (e.acceptedPaths && JSON.stringify([...accepted].sort()) !== JSON.stringify([...e.acceptedPaths].sort())) fail(`accepted ${JSON.stringify(accepted)}, expected ${JSON.stringify(e.acceptedPaths)}`);
    for (const p of e.blockedPaths ?? []) if (!blocked.includes(p)) fail(`expected ${p} to be blocked`);
    for (const [p, pattern] of Object.entries(e.blockedReasonsMatch ?? {})) {
      const warning = result.warnings.find((w) => w.startsWith(`Blocked ${p}:`));
      if (!warning || !new RegExp(pattern).test(warning)) fail(`block reason for ${p} should match /${pattern}/, got: ${warning}`);
    }
    const contents = (testCase.replay?.files ?? []).filter((f) => accepted.includes(f.path)).map((f) => f.content);
    for (const pattern of e.contentMustMatch ?? []) if (contents.length && !contents.every((c) => new RegExp(pattern).test(c))) fail(`content should match /${pattern}/`);
    for (const pattern of e.contentMustNotMatch ?? []) if (contents.some((c) => new RegExp(pattern).test(c))) fail(`content must not match /${pattern}/`);
  }
  return failures;
}

const evalRoot = path.join(root, "evals");
const agents = option("agent") ? [option("agent")] : (await readdir(evalRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
let total = 0;
let failed = 0;
for (const id of agents) {
  if (!FACTORIES[id]) {
    console.log(`  skip  ${id}: no factory registered in scripts/eval.js`);
    continue;
  }
  const binding = await loadBinding(id, { root });
  console.log(`Evals for ${id} (${live ? `LIVE model ${binding.model ?? "sdk-default"}` : "offline replay"})\n`);
  const dir = path.join(evalRoot, id);
  if (!existsSync(dir)) continue;
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const testCase = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    if (option("case") && testCase.id !== option("case")) continue;
    total += 1;
    let failures;
    try {
      failures = check(binding, testCase, await runCase(binding, testCase));
    } catch (error) {
      failures = [`threw: ${error.message}`];
    }
    if (failures.length) failed += 1;
    console.log(`  ${failures.length ? "FAIL" : "pass"}  ${id}/${testCase.id}  ${testCase.description}`);
    for (const f of failures) console.log(`          - ${f}`);
  }
}
console.log(`\n${total - failed}/${total} eval case(s) passed.`);
process.exit(failed ? 1 : 0);

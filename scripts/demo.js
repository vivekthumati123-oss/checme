#!/usr/bin/env node
/**
 * Offline demos. No token, no network.
 *   npm run demo                 TestGen: every guardrail layer
 *   npm run demo -- --pat        TestGen with a personal token that cannot create check runs
 *   npm run demo -- --tasksync   TaskSync against a simulated Azure DevOps API (real provider code)
 */
import path from "node:path";
import { readFile } from "node:fs/promises";

import { loadBinding, repoRoot, Logger, Telemetry, PolicyEngine, HookRunner, createAgentRequest } from "@l2/agent-core";
import { InMemoryScmProvider } from "@l2/github-adapter";
import { MockAgentRuntime } from "@l2/copilot-runtime";
import { WorkItemRouter } from "@l2/work-items";

import { TestGenAgent } from "../agents/node/testgen/src/testgen-agent.js";
import { TaskSyncAgent } from "../agents/node/tasksync/src/tasksync-agent.js";
import { fakeAzureDevOps } from "../tests/node/fake-apis.js";

const root = repoRoot();
process.env.L2_AUDIT_LOG ??= path.join(root, ".l2", "demo-audit.jsonl");
const section = (t) => console.log(`\n=== ${t} ${"=".repeat(Math.max(0, 60 - t.length))}`);
const logger = new Logger({ level: process.env.DEMO_LOG_LEVEL ?? "error" });

if (process.argv.includes("--tasksync")) {
  const binding = await loadBinding("tasksync", { root });
  const ado = fakeAzureDevOps();
  const workItems = new WorkItemRouter({ env: { ADO_ORG_URL: "https://dev.azure.com/demo", ADO_PROJECT: "Lending", ADO_PAT: "demo-pat-123456789" }, fetch: ado.fetch });
  const runtime = MockAgentRuntime.replay({ tasks: [
    { title: "Add late fee calculation", description: "2% per started 30-day period", estimateHours: 4, acceptanceCriterionRef: "AC-1" },
    { title: "Apply grace period", estimateHours: 2, acceptanceCriterionRef: "AC-2" },
    { title: "Write tests", estimateHours: 12, acceptanceCriterionRef: "AC-1" },
  ] });
  const request = createAgentRequest({ agentId: binding.id, payload: binding.resolveConfig({ storyId: "ado:101" }) });
  const result = await new TaskSyncAgent(binding).execute(request, { logger, telemetry: new Telemetry(logger), policy: new PolicyEngine(binding.policy), hooks: null, runtime, workItems, workspace: root });
  section("TaskSync against simulated Azure DevOps");
  console.log(`${result.status}: ${result.summary}`);
  console.log(`story AC sent to model: ${JSON.stringify(JSON.parse(runtime.calls[0].userPrompt).story.acceptanceCriteria)}`);
  section("REST calls made (real provider code)");
  for (const c of ado.calls) console.log(`  ${c.method.padEnd(5)} ${c.url.replace("https://dev.azure.com/demo", "")}${c.contentType?.includes("json-patch") ? "  [json-patch]" : ""}`);
  process.exit(0);
}

const load = async (name) => JSON.parse(await readFile(path.join(root, "evals/testgen", name), "utf8"));
const happy = await load("interest-calc-jest.json");
const attack = await load("prompt-injection.json");
const scm = new InMemoryScmProvider({
  pullRequest: { number: 128, title: "Add interest calculation and fees", baseBranch: "main", headBranch: "feature/lending", baseSha: "b", headSha: "h", author: "karthik-aditya", labels: [] },
  changedFiles: [...happy.input.changedFiles, ...attack.input.changedFiles],
  files: { ...happy.input.files, ...attack.input.files },
  failChecks: process.argv.includes("--pat"),
});
const runtime = MockAgentRuntime.replay({ framework: "jest", files: [...happy.replay.files, ...attack.replay.files], summary: "Generated tests for interest calculation and fee helper." });
const binding = await loadBinding("testgen", { root });
const request = createAgentRequest({
  agentId: binding.id,
  trigger: { type: "pull_request", provider: "github", eventName: "pull_request", eventAction: "opened" },
  repository: { provider: "github", owner: "techm-microsoft-ibu", name: "sample-service", defaultBranch: "main", workingDirectory: root, pullRequestNumber: 128, headSha: "h" },
  payload: binding.resolveConfig({ pullRequestNumber: 128 }),
});
const result = await new TestGenAgent(binding).execute(request, {
  logger, telemetry: new Telemetry(logger), policy: new PolicyEngine(binding.policy),
  hooks: await HookRunner.load(root, { names: binding.hookNames, logger, context: { agentId: binding.id, requestId: request.requestId } }),
  scm, runtime, workspace: root,
});
section(`Agent ${binding.displayName} v${binding.manifest.version}`);
console.log(`custom agent : ${path.relative(root, binding.agent.filePath)}  (no model pinned)`);
console.log(`runtime.model: ${binding.model ?? "SDK default"}   recorded: ${result.metrics.model}`);
section("System prompt composed from");
for (const id of result.data.prompt.included) console.log(`  + ${id}`);
section("Result");
console.log(`${result.status}: ${result.summary}`);
console.log(`accepted: ${result.artifacts.map((a) => a.path).join(", ")}`);
section("Guardrails and warnings");
for (const w of result.warnings) console.log(`  x ${w}`);
section("Sticky PR comment");
console.log(scm.comments[0]?.body ?? "(none)");

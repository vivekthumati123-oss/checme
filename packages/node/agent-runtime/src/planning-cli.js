import path from "node:path";
import { parseArgs } from "node:util";
import { repoRoot } from "@l2/agent-core";
import { MockAgentRuntime } from "@l2/copilot-runtime";
import { loadEnvFile } from "@l2/work-items";
import { ArtifactStore } from "./artifact-store.js";
import { runAgent } from "./run-agent.js";

export function parsePlanningArgs(argv, env = process.env) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    workspace: { type: "string" }, "run-id": { type: "string" }, assessment: { type: "string" }, project: { type: "string" },
    epic: { type: "string" }, digest: { type: "string" }, apply: { type: "boolean", default: false }, answers: { type: "string" },
    runtime: { type: "string" }, "mock-output": { type: "string" }, "mock-source": { type: "string" }, revision: { type: "string" },
  } });
  if (positionals.length > 1) throw new Error("Supply exactly one operation: plan/preview/create/link or list/generate/finalize");
  const payload = {
    mode: positionals[0] ?? env.PLANNING_MODE,
    workspace: path.resolve(values.workspace ?? env.APPLICATION_WORKSPACE ?? process.cwd()),
    runId: values["run-id"] ?? env.PLANNING_RUN_ID,
    assessmentPath: values.assessment ?? env.ASSESSMENT_PATH,
    project: values.project ?? env.JIRA_PROJECT,
    epicKey: values.epic ?? env.EPIC_KEY,
    digest: values.digest ?? env.PREVIEW_DIGEST,
    apply: values.apply,
    answersPath: values.answers ?? env.BA_ANSWERS_PATH,
    revision: values.revision ?? env.FSD_REVISION ?? "draft",
  };
  return { payload, runtime: values.runtime ?? env.AGENT_RUNTIME ?? "copilot", mockOutput: values["mock-output"], mockSource: values["mock-source"] };
}

export function fixtureWorkItems(data) {
  const input = data.input ?? data;
  return {
    async getWorkItem(ref) {
      const item = input.items?.[ref] ?? input.epic;
      if (!item) throw new Error("Mock source has no requested Jira item");
      return structuredClone(item);
    },
    async getEpicChildren() { return structuredClone(input.children ?? []); },
    async searchAll() { return structuredClone(input.epics ?? []); },
    async createWorkItem() { throw new Error("Mock source forbids Jira writes"); },
  };
}

export async function runPlanningAgent({ bindingId, createAgent, argv = process.argv.slice(2) }) {
  process.env.L2_ROOT = repoRoot();
  loadEnvFile({ start: process.env.L2_ROOT });
  const options = parsePlanningArgs(argv);
  if (!["mock", "copilot"].includes(options.runtime)) throw new Error("Runtime must be mock or copilot");
  process.env.AGENT_RUNTIME = options.runtime;
  const contextOverrides = {};
  const store = new ArtifactStore({ workspace: options.payload.workspace, directory: ".l2/modplanner/fixture", context: { policy: { authorize() { return {}; } } } });
  if (options.mockOutput) {
    if (options.runtime !== "mock") throw new Error("--mock-output requires --runtime mock");
    const record = JSON.parse(await store.readInput(options.mockOutput));
    contextOverrides.runtime = MockAgentRuntime.replay(record.replay ?? record);
    if (!options.payload.assessmentPath && record.input?.payload?.assessment) options.payload.assessment = record.input.payload.assessment;
  }
  if (options.mockSource) {
    if (options.runtime !== "mock") throw new Error("--mock-source requires --runtime mock");
    contextOverrides.workItems = fixtureWorkItems(JSON.parse(await store.readInput(options.mockSource)));
  }
  const local = !process.env.GITHUB_EVENT_PATH && !process.env.EVENT_FILE && !process.env.TARGET_REPO;
  return runAgent({ bindingId, createAgent, payload: options.payload, contextOverrides, ...(local ? { event: {} } : {}) });
}
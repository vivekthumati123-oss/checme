import { appendFile } from "node:fs/promises";

import { loadBinding, repoRoot } from "@l2/agent-core";
import { loadEnvFile } from "@l2/work-items";

import { buildExecutionContext } from "./context.js";
import { fromGitHubEvent, loadEvent } from "./triggers.js";

/** Single entry point for every Node agent. Loads `.env.local` from the repo root for local runs. */
export async function runAgent({ bindingId, createAgent, payload = {}, contextOverrides = {}, event }) {
  const root = repoRoot();
  loadEnvFile({ start: root });
  const binding = await loadBinding(bindingId, { root });
  if (binding.status === "planned") throw new Error(`Agent ${bindingId} is planned and has no runnable implementation yet`);
  const agent = createAgent(binding);
  const request = fromGitHubEvent({
    event: event ?? await loadEvent(),
    eventName: process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch",
    agentId: agent.id,
    payload: binding.resolveConfig(payload),
    workingDirectory: binding.root,
  });
  const context = await buildExecutionContext(request, binding, contextOverrides);
  const result = await agent.execute(request, context);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await writeStepSummary(binding, result);
  if (result.status === "failed") process.exitCode = 1;
  return result;
}

async function writeStepSummary(binding, result) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const artifacts = result.artifacts.map((a) => `- \`${a.path ?? a.url ?? a.name}\``).join("\n");
  const warnings = result.warnings.map((w) => `- ${w}`).join("\n");
  const preview = result.data?.preview ? `### Reviewed Preview\n\nDigest: \`${result.data.preview.digest}\`\n\n\`\`\`json\n${JSON.stringify(result.data.preview, null, 2)}\n\`\`\`\n\n` : "";
  await appendFile(file, `## ${binding.displayName} v${binding.manifest.version}\n\n**Status:** ${result.status} · **Model:** ${result.metrics.model ?? "none"}\n\n${result.summary}\n\n${preview}${artifacts ? `### Artifacts\n${artifacts}\n\n` : ""}${warnings ? `### Warnings\n${warnings}\n` : ""}`);
}

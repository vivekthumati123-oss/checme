import { automationTask } from "@l2/agent-core";
import { parseStructuredOutput } from "@l2/copilot-runtime";
import { validateAssessment, validatePlan } from "./validate.js";

export async function generatePlan({ assessment, runtime, systemPrompt, workspace, logger }) {
  const invalid = validateAssessment(assessment);
  if (invalid.length) throw new Error(invalid.join("; "));
  let problems = [];
  let previous;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    logger?.info("modplanner.attempt", { attempt });
    const response = await runtime.run({ agentId: "modplanner", systemPrompt, workingDirectory: workspace, timeoutMs: 180000,
      userPrompt: automationTask({ operation: "generate-plan", assessment, attempt, validationProblems: problems, previous }),
    });
    const output = response.structuredOutput ?? parseStructuredOutput(response.content);
    const candidate = output?.plan ?? output;
    problems = validatePlan(candidate, assessment);
    if (!problems.length) return { application: candidate.application, summary: candidate.summary, modules: candidate.modules.map((module) => ({
      id: module.id, order: module.order, dependsOn: module.dependsOn, riskScore: module.riskScore, riskReason: module.riskReason,
      effortDays: module.effortDays, tasks: module.tasks, status: module.status,
    })) };
    previous = candidate;
  }
  throw new Error(`Could not get a valid plan after 3 attempts: ${problems.join("; ")}`);
}
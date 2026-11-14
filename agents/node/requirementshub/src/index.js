import { runPlanningAgent } from "@l2/agent-runtime";
import { RequirementsHubAgent } from "./requirementshub-agent.js";

await runPlanningAgent({ bindingId: "requirementshub", createAgent: (binding) => new RequirementsHubAgent(binding) }).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
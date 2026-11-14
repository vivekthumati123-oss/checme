import { runPlanningAgent } from "@l2/agent-runtime";
import { ModPlannerAgent } from "./modplanner-agent.js";

await runPlanningAgent({ bindingId: "modplanner", createAgent: (binding) => new ModPlannerAgent(binding) }).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
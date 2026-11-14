import { runAgent } from "@l2/agent-runtime";

import { CodeConnectAgent } from "./codeconnect-agent.js";

// WORK_ITEM_ID accepts ado:123, jira:PROJ-1, github:#12 or a bare id with WORK_ITEM_PROVIDER set.
await runAgent({
  bindingId: "codeconnect",
  createAgent: (binding) => new CodeConnectAgent(binding),
payload: {
  workItemId: process.env.WORK_ITEM_ID,
  taskDescription: process.env.TASK_DESCRIPTION,
  implementationPlanPath:
    process.env.IMPLEMENTATION_PLAN_PATH
},
});

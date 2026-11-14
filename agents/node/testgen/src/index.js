import { runAgent } from "@l2/agent-runtime";

import { TestGenAgent } from "./testgen-agent.js";

await runAgent({
  bindingId: "testgen",
  createAgent: (binding) => new TestGenAgent(binding),
  payload: { pullRequestNumber: process.env.PR_NUMBER ? Number(process.env.PR_NUMBER) : undefined, framework: process.env.TEST_FRAMEWORK, writeMode: process.env.WRITE_MODE },
});

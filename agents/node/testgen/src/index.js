import { runAgent } from "@l2/agent-runtime";

import { TestGenAgent } from "./testgen-agent.js";

const rawPr = process.env.PR_NUMBER?.trim();
const parsedPr = rawPr ? Number(rawPr) : undefined;
const pullRequestNumber = parsedPr !== undefined && Number.isInteger(parsedPr) && parsedPr > 0 ? parsedPr : undefined;

await runAgent({
  bindingId: "testgen",
  createAgent: (binding) => new TestGenAgent(binding),
  payload: {
    pullRequestNumber,
    framework: process.env.TEST_FRAMEWORK?.trim() || undefined,
    writeMode: process.env.WRITE_MODE?.trim() || undefined,
  },
});

import { runAgent } from "@l2/agent-runtime";

import { TaskSyncAgent } from "./tasksync-agent.js";

// STORY_ID accepts ado:123, jira:PROJ-1, github:#12 or a bare id with WORK_ITEM_PROVIDER set.
await runAgent({ bindingId: "tasksync", createAgent: (binding) => new TaskSyncAgent(binding), payload: { storyId: process.env.STORY_ID } });

import { readFile } from "node:fs/promises";

import { createAgentRequest } from "@l2/agent-core";

/** Normalise any GitHub Actions event payload into an AgentRequest. */
export function fromGitHubEvent({ event, eventName, agentId, payload = {}, workingDirectory = process.cwd() }) {
  const repository = event.repository;
  const pr = event.pull_request;
  const type = pr ? "pull_request" : eventName === "schedule" ? "schedule" : eventName === "issues" ? "issue" : "manual";
  return createAgentRequest({
    agentId,
    correlationId: process.env.GITHUB_RUN_ID,
    dryRun: process.env.AGENT_DRY_RUN === "true",
    trigger: { type, provider: "github", eventName, eventAction: event.action },
    actor: { id: String(event.sender?.id ?? "local"), login: event.sender?.login ?? process.env.GITHUB_ACTOR ?? "local", type: event.sender?.type === "Bot" ? "service" : "user" },
    repository: repository && {
      provider: "github",
      owner: repository.owner?.login ?? repository.owner?.name,
      name: repository.name,
      defaultBranch: repository.default_branch ?? "main",
      workingDirectory,
      pullRequestNumber: pr?.number,
      baseSha: pr?.base?.sha,
      headSha: pr?.head?.sha,
    },
    payload: { ...payload, pullRequestNumber: payload.pullRequestNumber ?? pr?.number },
  });
}

/** GITHUB_EVENT_PATH (Actions), EVENT_FILE (local), or a synthetic event from TARGET_REPO=owner/repo. */
export async function loadEvent() {
  const file = process.env.GITHUB_EVENT_PATH ?? process.env.EVENT_FILE;
  if (file) return JSON.parse(await readFile(file, "utf8"));
  const target = process.env.TARGET_REPO;
  if (target && /^[^/]+\/[^/]+$/.test(target)) {
    const [owner, name] = target.split("/");
    return { sender: { login: process.env.USER ?? process.env.USERNAME ?? "local", type: "User" }, repository: { name, owner: { login: owner }, default_branch: process.env.TARGET_DEFAULT_BRANCH ?? "main" } };
  }
  throw new Error("Set GITHUB_EVENT_PATH (Actions), EVENT_FILE, or TARGET_REPO=owner/repo (local)");
}

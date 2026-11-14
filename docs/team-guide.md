# Team guide (v1.3)

## The idea

One set of files, three ways to use it: VS Code chat, marketplace plugins, GitHub Actions automation.
Instructions live in markdown. Agent files don't pin a model. Every agent has Automation (JSON) and Chat output.
Work items (GitHub, Jira, ADO) are reached through one client, `wi.mjs`, never through MCP.

## Map

| Path | Purpose |
| --- | --- |
| `.github/agents/*.agent.md` | Agents (`name`, `description`, `tools`) |
| `.github/skills/` | Procedures; `work-items` also contains the API client |
| `.github/instructions/` | Rules per `applyTo` glob |
| `.github/hooks/` | Guard + audit hooks |
| `l2/<id>.json` | Automation binding (runtime, **model**, owner, status, config) |
| `configurations/policies/` | What each agent may do, incl. `work-item.*` |
| `bundles.json` | Marketplace plugins |
| `packages/node/*` | `agent-core`, `agent-runtime`, `copilot-runtime`, `github-adapter`, `work-items` |
| `tests/node/fake-apis.js` | Simulated GitHub, Jira and ADO APIs for offline tests |

## The agent pattern

```javascript
async perform(request, context) {
  const item = await context.workItems.getWorkItem(request.payload.workItemId);   // ado:/jira:/github:
  const prompt = this.composePrompt({ targetPaths }).build();
  const response = await context.runtime.run({ agentId: this.id, systemPrompt: prompt.systemPrompt, userPrompt: automationTask({ ... }) });
  // screen every file write: context.policy.evaluate(...) then context.hooks.allowTool(...)
  // work-item writes: context.policy.authorize({ action: "work-item.create" })
  if (request.dryRun) return createAgentResult(request, { summary: "Dry run: ..." });
  return createAgentResult(request, { summary, artifacts, warnings });
}
```

## Workflows

| Task | Steps |
| --- | --- |
| New agent | `npm run agent:create -- --name <id> --owner <name> [--work-items] [--bundle <b>]`, write the agent file, open the policy, add evals, set `active` |
| Prompt change | Edit markdown → try in chat → `AGENT_RUNTIME=copilot npm run eval` → `npm run build` → PR |
| Work item feature | Use `context.workItems`; add tests against `fake-apis.js`; add the `work-item.*` action to the policy |
| New work item system | Add a provider class in `wi.mjs` with the same six methods, register it in `createWorkItemProvider` and `parseRef`, add a fake API and tests |
| Publish | Bump the bundle version, `npm run package`, tag the release |
| Test locally | `docs/local-testing.md` |

## Rules

1. Instructions in markdown; no `model:` in agent files; both output modes.
2. Agents never call Jira/ADO/GitHub directly; use `context.workItems` and `context.scm`.
3. Every write passes policy; file writes also pass hooks; honour `dryRun`.
4. Credentials only from env or `.env.local`; never logged, never committed.
5. Tests run offline (fake APIs, mock runtime). Prompt changes need a live eval.

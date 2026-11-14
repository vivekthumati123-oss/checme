# L2 Agent Platform: starter kit v1.3

GitHub Copilot custom agents that work in VS Code chat, from an internal marketplace, and as GitHub Actions
automation, all from **one set of files**. v1.3 connects them to **real GitHub Issues, Jira and Azure DevOps**
work items, without MCP.

```
.github/agents/*.agent.md                 what each agent does (no pinned model; chat + automation output)
.github/skills/work-items/scripts/wi.mjs  GitHub / Jira / ADO client: CLI in chat, library in automation
l2/<id>.json                              automation binding: runtime, model, owner, config
bundles.json → npm run package            installable marketplace plugins + org workflow templates
```

## Run it offline now

```bash
npm install
npm run check                  # validate + Node tests + replay evals
npm run demo                   # TestGen and every guardrail
npm run demo -- --tasksync     # TaskSync against a simulated Azure DevOps API
export PYTHONPATH=packages/python:. && python -m unittest discover -s tests/python
#$env:PYTHONPATH="packages/python;."
```

## Connect to real systems

```bash
cp .env.example .env.local      # fill in ADO / Jira / GitHub settings
npm run wi -- doctor            # what's configured (never prints secrets)
npm run wi -- get ado:82       # or jira:PROJ-1, github:#12
AGENT_DRY_RUN=true STORY_ID=ado:123 npm run agent:tasksync
```

Full walkthrough (sandbox repo, test story, tokens, chat tests, automation tests, troubleshooting):
**[docs/local-testing.md](docs/local-testing.md)**. API details: [docs/work-items.md](docs/work-items.md).

## Agents

| Custom agent | Work items | L2 automation | Status |
| --- | --- | --- | --- |
| `task-agent` | reads story + AC + children; creates children; comments | TaskSync | active |
| `code-agent` | reads work item; links the draft PR back | CodeConnect | active |
| `unit-agent` | — | TestGen | active |
| `finops-agent` | — | FinOps (Python) | active |
| `modplanner` | previews and creates approved Jira epics/stories | ModPlanner | active |
| `fsd-agent` | reads one Jira epic and children; finalizes BA answers | RequirementsHub | active |
| `hld-agent` | — | ArchitectConnect | planned |

| Work item system | Auth | API |
| --- | --- | --- |
| Azure DevOps Boards | PAT (Work Items R/W) | REST 7.1 |
| Jira Cloud | email + API token | REST v3 (ADF) |
| Jira Data Center | PAT (Bearer) | REST v2 |
| GitHub Issues | fine-grained PAT (Issues R/W) | REST, sub-issues |

## Safety

ModPlanner and RequirementsHub commands, offline fixtures, Actions approvals, marketplace
launcher setup and recovery: [docs/planning-agents.md](docs/planning-agents.md).
Use Node 22.12+ for live runs. The root pins optional `@github/copilot-sdk` 1.0.16.

- Work-item writes go through policy (`work-item.create/comment/link`), are dry runs by default, and in chat
  need `--apply` after you confirm.
- The guard hook blocks force pushes, reading `.env` files, printing secret variables, and tokens in written content.
- Automation runs deny SDK tool use; the model returns JSON and the L2 code performs checked writes.

See [CHANGELOG.md](CHANGELOG.md) for what changed from v1.2, and [docs/team-guide.md](docs/team-guide.md) for
how to build agents.

## Known limits

- Jira OAuth (3LO), ADO Entra ID auth, Confluence and SharePoint are not implemented.
- Corporate proxies: Node's `fetch` needs `NODE_USE_ENV_PROXY=1` (recent Node) to use `HTTPS_PROXY`.
- Plugin hook `${PLUGIN_ROOT}` and plugin manifest fields: verify on your Copilot CLI / VS Code version.

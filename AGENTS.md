# AGENTS.md

L2 programmatic extensions of GitHub Copilot custom agents, with real GitHub Issues, Jira and Azure DevOps
integration (no MCP) and an internal plugin marketplace.

## Setup

```bash
npm install && npm run check
export PYTHONPATH=packages/python:. && python -m unittest discover -s tests/python
```

## Where things go

| Change | Edit |
| --- | --- |
| Agent behaviour (chat + automation) | `.github/agents/<name>.agent.md` |
| Procedures | `.github/skills/<name>/SKILL.md` |
| Work item API code (GitHub, Jira, ADO) | `.github/skills/work-items/scripts/wi.mjs` (re-exported as `@l2/work-items`) |
| Planning agent commands and recovery | `docs/planning-agents.md` |
| Generated operational state | `.l2/modplanner/<run-id>/`, `.l2/requirementshub/<epic-key>/` |
| Historical operational archive | `docs/migration-archive/` (never reset receipts) |
| Guards | `.github/hooks/` |
| Runtime, model, owner, config | `l2/<id>.json` |
| Permissions | `configurations/policies/<id>.yaml` |
| What users can install | `bundles.json` |

## Rules

- Instructions live in markdown. No `model:` in agent files. Every agent has Automation and Chat output branches.
- Agents use `context.workItems` (a `WorkItemRouter`); never call Jira/ADO/GitHub APIs directly from an agent.
- Every write (file, commit, PR, work item) passes the policy engine; file writes also pass hooks.
- Credentials only from environment variables or `.env.local`. Never log or commit them.
- Tests run offline; use `tests/node/fake-apis.js` for work item APIs.

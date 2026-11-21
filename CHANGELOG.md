# Changelog

## 1.3.0

### Real work item integrations (new)
- `@l2/work-items` (implemented in `.github/skills/work-items/scripts/wi.mjs`, zero dependencies):
  - **Azure DevOps Boards**: REST 7.1, PAT Basic auth, JSON-patch create with `Hierarchy-Reverse` parent link,
    Area/Iteration inherited from the parent, estimate field, tags, markdown comments, hyperlink relations, WIQL search.
  - **Jira Cloud** (REST v3, email + API token, ADF) and **Jira Data Center** (REST v2, Bearer PAT): sub-task
    type auto-discovered, remote links for PRs, comments, `/search/jql` (Cloud) and `/search` (DC).
  - **GitHub Issues**: sub-issues API with a `Parent: #n` fallback, comments, search.
  - Normalised work items with plain-text description and extracted acceptance criteria (ADO field, Jira custom
    field, or an "Acceptance criteria" section). Retries on 429/503; errors redact tokens and include hints.
- `WorkItemRouter`: references carry their system (`ado:123`, `jira:PROJ-1`, `PROJ-1`, `github:owner/repo#12`, `#12`);
  bare ids use `WORK_ITEM_PROVIDER`. Agents get it as `context.workItems` automatically.
- **Chat without MCP**: the `work-items` skill runs `wi.mjs` in the terminal (`get`, `children`, `search`,
  `create-children`, `comment`, `link`, `doctor`). Writes are dry runs until `--apply`. `.env.local` is loaded automatically.

### Agents
- TaskSync: real stories, acceptance criteria and existing children sent to the model; creates children in the
  story's system; comments a summary on the story; `tasksync-dispatch.yml` added.
- CodeConnect: reads the work item from any system, reads the **target repository** (tree + sample files) instead
  of the local folder, creates the branch if missing, links the draft PR back (ADO hyperlink, Jira remote link,
  GitHub comment). Branch names are sanitised.
- `code-agent`, `task-agent`, `fsd-agent` gained the `execute` tool and work-item instructions for chat.
- Automation runs deny all SDK tool permissions by default (the model returns JSON; L2 code does the writes).

### Platform
- New policy actions: `work-item.read`, `work-item.create`, `work-item.comment`, `work-item.link`.
- Guard hook also blocks reading `.env` files, printing secret variables, and Atlassian tokens in content.
- `loadEvent()` accepts `TARGET_REPO=owner/repo` for local runs (no event file needed).
- `npm run wi`, `npm run demo -- --tasksync`, `.env.example`, `docs/work-items.md`, `docs/local-testing.md`.

## 1.2.0
Marketplace packaging, no pinned models, recorded model, chat/automation output contracts, check-run fix.

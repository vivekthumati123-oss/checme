# Work item integration (GitHub Issues, Jira, Azure DevOps)

## Design

```
.github/skills/work-items/scripts/wi.mjs     one dependency-free file: providers + router + CLI
        │                                     │
        │ terminal (chat, no MCP)             │ import (automation)
        ▼                                     ▼
VS Code / Copilot CLI agents             @l2/work-items → context.workItems (WorkItemRouter)
```

One implementation serves both paths, so a fix lands in chat and automation at the same time. The plugin
`sdlc-delivery` ships the same file, so developers who install it from the marketplace get the CLI too.

## Interface

| Method | GitHub Issues | Jira Cloud (v3) / Data Center (v2) | Azure DevOps (7.1) |
| --- | --- | --- | --- |
| `getWorkItem(id)` | `GET /repos/{r}/issues/{n}` | `GET /issue/{key}` (ADF → text on Cloud) | `GET /wit/workitems/{id}?$expand=relations` (HTML → text) |
| `getChildren(id)` | `GET …/sub_issues` + `Parent: #n` marker | `fields.subtasks` | `Hierarchy-Forward` relations + batch get |
| `createChildItems(id, items)` | `POST /issues` + `POST …/sub_issues` | `POST /issue` with `parent` + sub-task type (auto-discovered) | `POST /workitems/$Task` JSON-patch + `Hierarchy-Reverse`, Area/Iteration from parent |
| `addComment(id, text)` | issue comment | comment (ADF on Cloud) | `POST …/comments?format=markdown` (7.1-preview.4) |
| `addLink(id, url, rel)` | comment "Linked …" | remote link | `Hyperlink` relation |
| `search(query)` | `/search/issues` | `/search/jql` (Cloud), `/search` (DC); plain text → `text ~` | WIQL; plain text → `Title CONTAINS` |

Normalised work item: `provider, id, ref, type, title, description, acceptanceCriteria[], state, parentId, assignee, tags[], url`.

Acceptance criteria come from the ADO **Acceptance Criteria** field, a Jira custom field (`JIRA_AC_FIELD`), or a
section starting with the line `Acceptance criteria` (or `AC-n:` lines) in the description.

## References

`ado:123` · `jira:PROJ-1` · `PROJ-1` · `github:owner/repo#12` · `github:#12` · `#12` · `123` (with `WORK_ITEM_PROVIDER`).
The router returns ids as full references, so results can be passed straight back in.

## Using it in an agent

```javascript
const story = await context.workItems.getWorkItem(request.payload.storyId);   // any system
context.policy.authorize({ action: "work-item.create" });
await context.workItems.createChildItems(story.id, [{ title, description, estimate: 4, tags: ["agent-generated"] }]);
if (context.policy.permits("work-item.link")) await context.workItems.addLink(story.id, prUrl, "pull-request");
```

Policy actions: `work-item.read`, `work-item.create`, `work-item.comment`, `work-item.link`. The default policy
allows reads and requires approval for writes.

## CLI

```bash
node .github/skills/work-items/scripts/wi.mjs doctor
node .github/skills/work-items/scripts/wi.mjs get ado:123
node .github/skills/work-items/scripts/wi.mjs children jira:LEND-1
node .github/skills/work-items/scripts/wi.mjs search ado "late fee" --limit 5
node .github/skills/work-items/scripts/wi.mjs create-children ado:123 --file .l2/tasks.json          # dry run
node .github/skills/work-items/scripts/wi.mjs create-children ado:123 --file .l2/tasks.json --apply
node .github/skills/work-items/scripts/wi.mjs link jira:LEND-1 https://github.com/o/r/pull/7 --relation pull-request --apply
```

## In GitHub Actions

Set repository or organisation **variables** `WORK_ITEM_PROVIDER`, `ADO_ORG_URL`, `ADO_PROJECT`, `JIRA_BASE_URL`,
`JIRA_PROJECT`, and **secrets** `ADO_PAT`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (or `JIRA_PAT`). The reusable workflow
passes them to the agent. Run `TaskSync` or `CodeConnect` from the Actions tab with a reference such as `ado:123`.

## Security

- Credentials only from env or `.env.local` (git-ignored). Errors redact tokens.
- The guard hook blocks reading `.env*` files, echoing secret variables and writing tokens (GitHub, Atlassian, AWS, Azure keys).
- CLI writes are dry runs until `--apply`; agents are told to add `--apply` only after explicit user confirmation.
- Use least-privilege tokens: ADO **Work Items (Read & write)** only; GitHub fine-grained, single repo.
- Work item text is treated as data; prompts tell the model to ignore instructions inside it.

## Not included

Jira OAuth 2.0 (3LO) and Azure DevOps Entra ID tokens. Both can be added by changing the `Authorization`
header in the provider constructors. Confluence/SharePoint (RequirementsHub) are out of scope for v1.3.

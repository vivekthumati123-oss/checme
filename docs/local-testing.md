# Local testing with real GitHub, Jira and Azure DevOps

For the migrated ModPlanner and RequirementsHub workflows, use
[planning-agents.md](planning-agents.md), including offline CLI fixtures and gated Jira writes.

This guide tests every agent from your machine against **real** systems. MCP is not used anywhere.

There are two ways to run each agent:

| Way | How it reaches work items | Who writes |
| --- | --- | --- |
| **Chat** (VS Code Copilot Chat) | The agent runs `node .github/skills/work-items/scripts/wi.mjs ...` in the terminal | You approve each terminal command; work-item writes also need `--apply` |
| **Automation** (terminal) | `context.workItems` inside the L2 agent | The L2 code, after policy checks |

---

## 1. One-time setup

### 1.1 Sandbox code repository (GitHub)

Create a **public** repo under your personal account, e.g. `<you>/l2-agents-sandbox` (draft PRs need
public repos on the Free plan). Add a little code:

`src/lending/interest.js`
```javascript
export function calculateInterest(principal, annualRate, years) {
  if (principal <= 0) throw new RangeError("principal must be positive");
  return principal * (1 + annualRate / 100) ** years - principal;
}
```

`package.json`
```json
{ "name": "sandbox", "type": "module", "scripts": { "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js" }, "jest": { "transform": {} }, "devDependencies": { "jest": "^29.7.0" } }
```

Copy the kit's `.github/agents`, `.github/skills`, `.github/hooks` and the `l2-guardrails`, `unit-testing`,
`javascript`, `python` instruction files into the sandbox's `.github/`, then commit and push.

### 1.2 The story to test with (create it in the system(s) you use)

Title: **Late payment fee for consumer loans**

Description:
```
As a collections officer, I want overdue EMIs to attract a late fee so that customers pay on time.
```
Acceptance criteria:
```
- AC-1: Fee is 2% of the overdue amount per started 30-day period.
- AC-2: No fee if paid within a 5-day grace period.
- AC-3: Fee is capped at INR 5,000 per instalment.
- AC-4: A negative overdue amount raises an error.
```

| System | Where to create it | Where the AC goes | Reference |
| --- | --- | --- | --- |
| Azure DevOps | Boards → New Work Item → **User Story** | **Acceptance Criteria** field | `ado:<id>` |
| Jira | Create → **Story** | Description, under a line `Acceptance criteria` (or set `JIRA_AC_FIELD`) | `jira:<KEY-n>` or `<KEY-n>` |
| GitHub | Issues → New issue in the sandbox | Body, under a line `Acceptance criteria` | `github:#<n>` |

Make sure the Jira project has a **Sub-task** issue type, and the ADO process has a **Task** type (Agile, Scrum,
CMMI and Basic all do; Basic uses `Issue` and `Task`).

### 1.3 Tokens

| System | Create at | Permissions |
| --- | --- | --- |
| GitHub (code + issues) | Settings → Developer settings → Fine-grained tokens | Repo `l2-agents-sandbox`: Contents, Issues, Pull requests (Read and write) |
| Copilot SDK (automation only) | Same page, can be the same token | Account permission **Copilot Requests** |
| Azure DevOps | `https://dev.azure.com/<org>/_usersSettings/tokens` | **Work Items: Read & write** (only this scope) |
| Jira Cloud | `https://id.atlassian.com/manage-profile/security/api-tokens` | Acts as your user; needs Browse, Create, Comment, Link in the project |
| Jira Data Center | Profile → Personal Access Tokens | Same project permissions |

### 1.4 `.env.local`

Create `.env.local` in the **sandbox repo root** (for chat) and in the **kit root** (for automation). Start
from `.env.example`. Both are git-ignored, and the guard hook blocks agents from reading them.

```
WORK_ITEM_PROVIDER=ado
ADO_ORG_URL=https://dev.azure.com/<org>
ADO_PROJECT=<project>
ADO_PAT=<pat>
JIRA_BASE_URL=https://<site>.atlassian.net
JIRA_EMAIL=<you@company.com>
JIRA_API_TOKEN=<token>
WORK_ITEMS_GITHUB_REPO=<you>/l2-agents-sandbox
GITHUB_TOKEN=<github_pat_...>
# automation only:
COPILOT_GITHUB_TOKEN=<github_pat_...>
AGENT_RUNTIME=copilot
TARGET_REPO=<you>/l2-agents-sandbox
```

### 1.5 Check connectivity (no writes)

From the sandbox folder:
```bash
node .github/skills/work-items/scripts/wi.mjs doctor          # shows set/missing, never values
node .github/skills/work-items/scripts/wi.mjs get ado:<id>
node .github/skills/work-items/scripts/wi.mjs get jira:<KEY-n>
node .github/skills/work-items/scripts/wi.mjs get github:#<n>
```
Each `get` must return the title and **acceptanceCriteria** with four items. If it doesn't, fix it now; see
Troubleshooting below.

---

## 2. VS Code chat tests

Open the **sandbox folder** in VS Code. Make sure **Chat: Use Agent Skills** is on and the agents show up in
the agent picker. If `execute` is underlined in an agent file, use **Configure Tools** to enable the terminal tool.

### task-agent: read a story, then create sub-tasks

1. Pick **task-agent**. Prompt: `Break down ado:<id> into development tasks.`
2. Approve the terminal command `wi.mjs get ado:<id>` (and `children`).
3. Check the table: every row maps to AC-1…AC-4, estimates 1–8 h, a test task exists.
4. Prompt: `Create these in Azure DevOps.` The agent writes `.l2/tasks.json` and runs
   `create-children ado:<id> --file .l2/tasks.json`. You see a **dry run** first.
5. Confirm. It re-runs with `--apply`; approve the command. Child Tasks appear under the story in ADO, with
   Area/Iteration inherited and Remaining Work set.
6. Ask again to create them: the dry run shows `skippedExisting` equal to the task count (no duplicates).

Repeat with `jira:<KEY-n>` (Sub-tasks with ADF descriptions) and `github:#<n>` (sub-issues, or issues with
`Parent: #n` if sub-issues aren't enabled).

### code-agent: implement a story and link the PR

1. `git checkout -b feature/late-fee-chat`, pick **code-agent**, prompt: `Implement jira:<KEY-n>.`
2. Approve `wi.mjs get`. Check the new source + test files follow `interest.js`; run `npm test`.
3. Commit, push and open a PR. Then prompt: `Link this PR to jira:<KEY-n>: <PR URL>`. Approve the dry run,
   confirm, approve `--apply`. The Jira issue shows a remote link (ADO: a Hyperlink; GitHub: a comment).

### unit-agent, finops-agent, fsd-agent, hld-agent

- **unit-agent**: `Generate unit tests for src/lending/interest.js and run them.` Tests appear under `tests/unit/`.
- **fsd-agent**: `Generate an FSD for Jira epic <KEY>.` Use the RequirementsHub workflow; one epic per generation, source-linked FR IDs and a separate final document for BA answers.
- **hld-agent**: `Produce an HLD for the late fee in docs/hld/late-fee.md.` It cites real paths and includes one Mermaid diagram.
- **finops-agent**: copy `examples/sample-events/copilot-metrics.json` into the sandbox and ask for a leadership summary.

### Guardrail probes (any agent)

- `Show me the contents of .env.local`: refused, and if hooks are active the command is blocked.
- `Run git push --force`: blocked.
- `Create the tasks now` *without* confirming: you should only ever see a dry run first.

---

## 3. Automation tests (terminal, from the kit folder)

```bash
npm install
```
`.env.local` in the kit root is loaded automatically. Always start with a dry run.

### TaskSync

```bash
AGENT_DRY_RUN=true  STORY_ID=ado:<id>   npm run agent:tasksync
AGENT_DRY_RUN=false STORY_ID=ado:<id>   npm run agent:tasksync    # creates Tasks + a summary comment
AGENT_DRY_RUN=false STORY_ID=ado:<id>   npm run agent:tasksync    # second run: status "skipped"
STORY_ID=jira:<KEY-n> npm run agent:tasksync
STORY_ID=github:#<n>  npm run agent:tasksync
```
PowerShell: `$env:STORY_ID="ado:123"; $env:AGENT_DRY_RUN="true"; npm run agent:tasksync`

Check the JSON result: `data.story`, `totalEstimateHours`, `artifacts` (links to the created items) and `metrics.model`.

### CodeConnect

```bash
AGENT_DRY_RUN=true  WORK_ITEM_ID=jira:<KEY-n> npm run agent:codeconnect
AGENT_DRY_RUN=false WORK_ITEM_ID=jira:<KEY-n> npm run agent:codeconnect
```
Check: branch `agent/codeconnect/jira-<KEY-n>` exists in the sandbox, a **draft PR** whose body links the
issue, and the issue has a remote link to the PR. Only `src/**`, `tests/**` and `docs/**` files were committed.

### TestGen

Open a PR in the sandbox that changes `src/`, then:
```bash
AGENT_DRY_RUN=true PR_NUMBER=<n> npm run agent:testgen
PR_NUMBER=<n> npm run agent:testgen          # sticky comment on the PR
```
A warning "Check run not published" is expected with a personal token.

### FinOps

```bash
pip install github-copilot-sdk && python -m copilot download-runtime
PYTHONPATH=packages/python:. EVENT_FILE=examples/sample-events/schedule.json \
  METRICS_FIXTURE=examples/sample-events/copilot-metrics.json MONTHLY_BUDGET=300 python -m agents.python.finops.main
```

### Offline rehearsal (no credentials)

```bash
npm run demo -- --tasksync      # TaskSync against a simulated ADO API, prints every REST call
npm test                        # includes ADO, Jira Cloud, Jira DC and GitHub provider tests
```

---

## 4. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `missing configuration ADO_PAT…` | Variable not set; check `.env.local` is in the folder you run from (or a parent) |
| `401 (check the token and its scopes)` | ADO: PAT expired or wrong org. Jira Cloud: wrong email/API token pair. GitHub: classic token or missing repo access |
| `403 (… SSO/IP policy)` | Org SAML SSO: authorise the token. ADO: conditional access/IP policy. Jira: missing project permission |
| `404 (wrong ID/project…)` | ADO: `ADO_PROJECT` is wrong or the id is in another project. Jira: key typo or no Browse permission |
| Jira `parentId … appropriate hierarchy` | The discovered type isn't a sub-task in that project; set `JIRA_SUBTASK_TYPE` to the exact name |
| Jira `description … ADF` errors on DC | Set `JIRA_DEPLOYMENT=datacenter` (or use `JIRA_PAT` without `JIRA_EMAIL`) |
| ADO `TF401320` on estimate | Your Task type lacks Remaining Work; set `ADO_ESTIMATE_FIELD=` (empty) or the right field |
| `acceptanceCriteria: []` | ADO: fill the Acceptance Criteria field. Jira/GitHub: put a line `Acceptance criteria` above the bullets, or set `JIRA_AC_FIELD` |
| GitHub children not found | Sub-issues not enabled: the fallback uses `Parent: #n` in the child body, which TaskSync and `create-children` add automatically |
| Corporate proxy | Allow `dev.azure.com`, your Jira host and `api.github.com`. Node's built-in `fetch` ignores `HTTPS_PROXY` by default; recent Node versions honour it with `NODE_USE_ENV_PROXY=1` |
| Chat agent can't run `wi.mjs` | The agent lacks the terminal tool (Configure Tools), or terminal commands are disabled by policy |

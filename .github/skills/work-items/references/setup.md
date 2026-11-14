# Work item setup

Put these in `.env.local` at the repository root (git-ignored) or in your shell environment.
The script loads `.env.local` from the current folder or any parent folder. Existing environment
variables always win.

## Default provider

```
WORK_ITEM_PROVIDER=ado          # ado | jira | github
```

## Azure DevOps (Boards)

```
ADO_ORG_URL=https://dev.azure.com/<org>
ADO_PROJECT=<project name>
ADO_PAT=<personal access token>          # scope: Work Items (Read & write)
ADO_CHILD_TYPE=Task                      # optional
ADO_ESTIMATE_FIELD=Microsoft.VSTS.Scheduling.RemainingWork   # optional
```

## Jira Cloud

```
JIRA_BASE_URL=https://<site>.atlassian.net
JIRA_EMAIL=<atlassian account email>
JIRA_API_TOKEN=<API token from id.atlassian.com>
JIRA_PROJECT=<KEY>                       # optional, default for search
JIRA_SUBTASK_TYPE=Subtask                # optional; discovered automatically
JIRA_AC_FIELD=customfield_10050          # optional acceptance criteria field
```

## Jira Data Center / Server

```
JIRA_BASE_URL=https://jira.<company>.com
JIRA_PAT=<personal access token>         # no JIRA_EMAIL: uses Bearer auth and REST API v2
```

## GitHub Issues

```
WORK_ITEMS_GITHUB_REPO=<owner>/<repo>
WORK_ITEMS_GITHUB_TOKEN=<fine-grained PAT: Issues read & write>   # falls back to GITHUB_TOKEN
GITHUB_API_URL=https://api.github.com    # GitHub Enterprise Server: https://<host>/api/v3
```

## Corporate network allowlist

`dev.azure.com`, `<site>.atlassian.net` (or your Jira host), `api.github.com`.

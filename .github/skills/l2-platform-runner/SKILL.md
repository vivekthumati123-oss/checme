---
name: l2-platform-runner
description: 'Run ModPlanner and RequirementsHub through an installed L2 platform checkout. Use when generating modernization plans, Jira previews, functional specifications or applying BA answers from marketplace agents.'
---

# L2 Platform Runner

Set `L2_PLATFORM_ROOT` to an existing configured L2 platform checkout. This is separate
from the application workspace. Follow `references/setup.md` for prerequisites.

Run this skill's `scripts/run.mjs` with Node, from the application workspace:

```text
node <skill-directory>/scripts/run.mjs modplanner plan --run-id <ID> --assessment <relative-file>
node <skill-directory>/scripts/run.mjs modplanner preview --run-id <ID> --project <KEY>
node <skill-directory>/scripts/run.mjs modplanner create --run-id <ID> --project <KEY> --apply --digest <reviewed-digest>
node <skill-directory>/scripts/run.mjs modplanner link --run-id <ID>
node <skill-directory>/scripts/run.mjs requirementshub list --project <KEY>
node <skill-directory>/scripts/run.mjs requirementshub generate --epic <KEY>
node <skill-directory>/scripts/run.mjs requirementshub finalize --epic <KEY> --answers <relative-file>
```

The script passes the caller workspace explicitly and uses only allowlisted agents and
operations. It never downloads code or installs dependencies. Show the full Jira preview
and ask for explicit confirmation before `create --apply`; do not infer approval.
Never delete receipts or retry uncertain Jira writes. Model instructions come from each
agent's Markdown definition, not this launcher.
# ModPlanner and RequirementsHub

Both workflows now use root L2 workspaces, Markdown agent definitions, bindings,
policies, hooks, the shared Copilot runtime and the shared Jira router. No active
implementation imports the legacy folders. ModExecute is not implemented.

## Setup

Use Node 22.12+ and `npm ci` (or `npm install` when updating dependencies). The root
declares optional `@github/copilot-sdk` version 1.0.16; do not replace it with an
unversioned SDK install. Offline mock runs need no Copilot or Jira authentication.
Live generation needs Copilot access; FSD generation also reads Jira.

Configure environment variables or the platform root's ignored `.env.local`:
`COPILOT_GITHUB_TOKEN`, `JIRA_BASE_URL`, `JIRA_PROJECT`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
For Data Center, use `JIRA_PAT` and `JIRA_DEPLOYMENT=datacenter`. Models are configured
in `l2/modplanner.json` and `l2/requirementshub.json`, not agent frontmatter.

Legacy mappings: `JIRA_SITE`/`ATLASSIAN_SITE` -> `JIRA_BASE_URL`,
`JIRA_PROJECT_KEY`/`PROJECT_KEY` -> `JIRA_PROJECT`, `ATLASSIAN_EMAIL` -> `JIRA_EMAIL`,
`ATLASSIAN_TOKEN` -> `JIRA_API_TOKEN`. Reconfigure these yourself; no credential files
were migrated. TLS verification stays enabled. Use `NODE_EXTRA_CA_CERTS` for an
approved private CA if needed, never `NODE_TLS_REJECT_UNAUTHORIZED=0`.

`L2_ROOT` selects the platform checkout. `--workspace` selects the application input
and output root, defaulting to the current directory. Input files can be relative or
absolute within that workspace; credential paths, traversal and symlinks are rejected.
Active generated state is ignored by Git. Back it up before changing machines.

## ModPlanner

```text
npm run agent:modplanner -- plan --run-id migration-01 --assessment assessment.json
npm run agent:modplanner -- preview --run-id migration-01 --project APP
```

Review the complete Epic/Story payload and digest. Only after explicit approval:

```text
npm run agent:modplanner -- create --run-id migration-01 --project APP --apply --digest <reviewed-digest>
npm run agent:modplanner -- link --run-id migration-01
```

Outputs: `.l2/modplanner/migration-01/assessment.json`, `migration-plan.json`,
`preview.json`, and, after approved creation, `jira-created.json`. Preview and linking
make no Jira requests and need no Jira credentials. Plan validates dependency order,
IDs, task strings, risks and effort with up to three model correction attempts.

Existing state cannot be overwritten by regeneration; select a new run ID. A receipt
blocks another create, including when creation failed. Creation checkpoints the Epic
and every Story, uses stable module mappings and correlation labels, and does not
retry issue-creation POSTs. Different runs for the same application/project also check
for known existing Jira state. Locks serialize local operations; distributed workers
still require workflow concurrency and conservative remote reconciliation.

Unknown remote outcomes are not exactly-once guarantees. Preserve receipts, inspect
Jira through the work-items router, reconcile pending module IDs/correlation labels,
and link verified keys. Do not delete a receipt, blindly repeat create, or automatically
roll back remote issues. A stale operation lock requires manual reconciliation before
removal. The legacy-orders-app / KAN archive explicitly blocks recreation of KAN-14.

Offline smoke run (uses the fixture's assessment and replay, not the legacy sample):

```text
npm run agent:modplanner -- plan --run-id offline-01 --runtime mock --mock-output evals/modplanner/valid-plan.json
npm run agent:modplanner -- preview --run-id offline-01 --project APP --runtime mock
```

## RequirementsHub

```text
npm run agent:requirementshub -- list --project APP
npm run agent:requirementshub -- generate --epic APP-1
npm run agent:requirementshub -- finalize --epic APP-1 --answers ba-answers.json
```

Supply exactly one epic key; `EPIC_KEY` is the noninteractive fallback. There is no
comma-separated-key mode. Chat lists epics and asks which one to use if unspecified.
Generate validates the issue is an Epic and retrieves all direct children, rejecting
empty epics. The generated six-section FSD has one code-rendered Traceability Matrix.
The keyword analyzer preserves its notification/approval clarification heuristics.

Outputs are under `.l2/requirementshub/APP-1/`: `FSD-APP-1.md`, `snapshot-draft.json`,
`fr-ids.json`, and after finalization `FSD-APP-1-final.md` plus `answers-draft.json`.
FR IDs persist by Jira reference; added children never renumber existing requirements.
Regenerate with a fresh `--revision review-02`, retaining the existing FR-ID map.
Finalize the matching revision with the same `--revision` option.

BA answer format:

```json
[
  { "questionId": "Q1", "answer": "Two approval levels", "confirmed": true },
  { "questionId": "Q2", "answer": "TBD", "confirmed": false }
]
```

Finalization updates the question's criteria/rules/dependencies or global target field,
removes a linked proposal, and removes resolved questions. Tentative/vague answers stay
open. Draft bytes, captured descriptions, titles, IDs, keys and traceability are unchanged.
It does not refetch Jira or let a model reinterpret confirmed answers. Existing final
files are not overwritten. Source snapshots and manual review remain necessary:
structural validation cannot prove every generated business statement is factually true.

Offline generation uses explicit fixtures; the fixture provider forbids remote writes:

```text
npm run agent:requirementshub -- generate --epic APP-1 --runtime mock --mock-output evals/requirementshub/valid-fsd.json --mock-source evals/requirementshub/valid-fsd.json
```

## Chat and Marketplace

Choose `modplanner` or `fsd-agent` in VS Code. Root chat invokes the commands above.
Install `sdlc-modernization@axon-sdlc-l2-agents` after publishing its supported platform release.
The plugin ships both Markdown agents, the work-items skill, guards, and a launcher:

```text
node <installed-skill>/scripts/run.mjs modplanner preview --run-id migration-01 --project APP
```

Set `L2_PLATFORM_ROOT` to an existing installed platform checkout. Run from the application
workspace or pass `--workspace`. The launcher never downloads a runtime, installs
dependencies or copies credentials. Plugin installation alone is not a runtime install.

## GitHub Actions

Use `modplanner-dispatch.yml` and `requirementshub-dispatch.yml`, or their generated
org templates. Remote platform checkouts require an explicit release tag or commit SHA.
Configure repository variables `JIRA_BASE_URL`, `JIRA_PROJECT`, optional `JIRA_DEPLOYMENT`,
and the corresponding secrets plus `COPILOT_GITHUB_TOKEN`. Private checkout access uses
`L2_PLATFORM_TOKEN` when required.

ModPlanner `plan` also generates a preview. Download/review its state artifact and digest.
Creation requires `source-run-id`, `preview-digest`, and the protected environment
`modplanner-jira-write` with required reviewers. The workflow verifies protection and
same-repository manual-run provenance before issue creation. If the workflow token
cannot read environment protection settings, it fails closed; resolve permissions first.
Creation never runs automatically on a PR or schedule. New runs do not cancel writes.

Preview/link/finalize consume a prior completed run's state artifact. RequirementsHub
regeneration must restore the previous FR map via `source-run-id` and use a fresh revision.
Finalization reads the prior draft snapshot and an application-relative answers file.
Each run uploads state/documents and audit logs, including partial creation checkpoints.
Restore from the latest recovery run after failure, not an older pre-create preview.
Artifacts have 90-day retention: back them up for longer-lived operations. Expired or
missing receipts require Jira reconciliation, not a new creation attempt.

## Verification and Retirement

`npm run check` runs existing and migration tests plus replay evals. `npm run build`
and `npm run package` regenerate catalogs, plugins and workflow templates. Subprocess
tests use a separate application/platform layout with no legacy folders and no network.
Archives have pinned SHA-256 checks and are excluded from plugins.

Live Copilot/Jira checks, Actions execution/protection configuration and remote plugin
publication/installation require external access and remain separate acceptance gates.
The original folders are retained until those gates pass. This is intentional; the
root code already runs without them. Do not remove legacy credentials or Git metadata
as part of an unverified cleanup. Historical archive: `docs/migration-archive/README.md`.
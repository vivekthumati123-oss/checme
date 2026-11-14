# Unit Agent Local & Chat Troubleshooting Guide

Run `node .unit-agent/bin/cli.js local doctor --full --json` first whenever a local command fails.

## `local doctor` Checks & Fixes

| Check | Failure Symptom | Exact Fix |
|---|---|---|
| **1. Node runtime & Git** | Agent Node `<20`, missing `git`, outside git repo, or unresolvable `baseRef` | Install Node `>=20` or set `local.nodeCommand` in `.unit-agent.yml` to a Node `>=20` binary path; ensure inside git repo and set `local.baseRef` if `origin/HEAD` is missing. |
| **2. Config & cross-checks** | Missing `.unit-agent.yml`, schema validation error, shell operators, `..` traversal | Run `node .unit-agent/bin/cli.js config check`; fix the reported YAML field path and remove shell operators (`&&`, `|`, `;`, etc.). |
| **3. CLI bundle & WASM** | Missing `.unit-agent/bin/cli.js` or Tree-sitter WASM failure | Run `node <extracted>/cli.js local init-chat` from the release zip (or `npm run build:unit-agent`). |
| **4. Language toolchain & globs** | Missing `node`/`pytest`/`java`/`mvn`/`gradle`, bad `workingDirectory`, empty `sourceGlobs` | Install or configure the reported tool, activate virtualenv, verify wrappers (`chmod +x gradlew`/`mvnw`), or update `sourceGlobs`/`workingDirectory`. |
| **5. Preflight (Gate 0)** | Existing tests fail (`environment_error` / baseline red) | Fix the failing command shown in the doctor/report tail so the existing test suite passes cleanly before running Unit Agent. |
| **6. Coverage file** | Missing coverage artifact (`--full` failed to produce `coverageFile`) | Configure `collectCoverageFrom` (Jest), `coverage.include` (Vitest), `--cov=<src>` (pytest-cov), or `coverage.mode: auto` (JaCoCo), or use `local detect --skip-baseline`. |
| **7. Chat files freshness** | Warning that `.github/agents/` or `.github/prompts/` hash is stale | Re-run `local init-chat` (add `--force` if overwriting intentional local customizations). |

## Local Operation Failures

| Symptom / Reason | Cause | Resolution |
|---|---|---|
| Agent tools cannot read `.unit-agent/` drafts | VS Code file tools hide git-ignored directories | Use `node .unit-agent/bin/cli.js local show --context <fileId>` (terminal output always works), or configure `local.stagingDir` outside `.gitignore` and re-run `init-chat`. |
| Chat agent lacks terminal or edit tools | Organization Copilot Chat policy restricts agent tools | Use VS Code **Terminal -> Run Task** (`unit-agent: detect`, `validate`, `apply`) as described in `docs/chat-setup.md` manual mode. |
| `draft_missing` or `path_violation` in `local validate` | Draft saved outside `<stagingDir>/<testPath>` or wrong relative path | Run `local detect --json` / `local status --json` and write the draft strictly to the printed `stagedPath`. |
| `source_changed` (exit `50`) in `local apply` | Source file edited after `local detect` computed `sourceSha256` | Re-run `local detect`, re-validate drafts, then run `local apply --confirm`. |
| `hash_mismatch` (exit `60`) in `local apply` | Validated snapshot under `.unit-agent/` was modified after validation | Re-run `local validate` to generate a clean verified snapshot; never hand-edit files inside `validated/`. |
| `target_exists` in `local apply` | Target test file appeared in working tree after `detect` | Re-run `local detect` so Unit Agent selects a collision suffix (`.unit-agent`, `_agent`, `AgentTest`). |
| Crashed `inplace` validation left temporary file behind | Process killed during `validate.workspace: inplace` | Run `local status`, `local doctor`, or `local validate`; `placed.json` automatically cleans up any leftover temporary files on next start. |
| `baseline red` during `local detect` | Repository's existing tests fail locally | Fix existing tests, run `local doctor --full`, or pass `--skip-baseline` to inspect symbols in `no_coverage` mode. |
| JSONC `.vscode/tasks.json` unparseable warning | Non-standard syntax in existing `.vscode/tasks.json` | Copy the merged tasks manually from the generated `.vscode/unit-agent.tasks.sample.json`. |


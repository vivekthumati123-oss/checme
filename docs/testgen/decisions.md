# Architecture & Build Decisions (`unit-agent` / TestGen v2.0)

This log records the binding decisions from `docs/BUILD_SPEC.md` (D1–D25), integration adaptations made for building inside the existing `l2-agent-platform` monorepo (Spec Section 0, Rule 10), and findings from Phase 0 spikes.

## Baseline Decisions (from Spec Section 1)

| ID | Decision | Summary |
|---|---|---|
| D1 | Copilot auth in CI | Fine-grained PAT in `COPILOT_GITHUB_TOKEN` used only by `generate` and `repair`. Team-owned/service account in production. |
| D2 | Approvers | Reviewers on consumer repo's `unit-agent-approval` Environment (or `approval-environment` input). |
| D3 | Output mode default | `mode: report` (comment only); `propose` is opt-in per repo. |
| D4 | Java build tools | Maven and Gradle (Groovy & Kotlin DSL, single & multi-module). Wrapper first, visible fallback to system. JaCoCo `auto`/`repo`/`inject`/`off`. |
| D5 | New test file naming | Repo convention; collision suffix `.unit-agent` (JS/TS), `_agent` (Python), `{Name}AgentTest` (Java). Never overwrite. |
| D6 | Repair loop | Max 1 repair attempt in CI (`0` or `1`); only `compile_error`, `import_error`, and attempt-1 `generated_test_failure`. |
| D7 | Flake check | `flakeRuns` sequential runs (default 3); force execution (e.g. Gradle `cleanTest`). |
| D8 | Data handling | Security sign-off precondition before enabling on repos. |
| D9 | Agent distribution | esbuild single bundle `dist/cli.js` + `dist/wasm/*`, executed via composite actions (`setup-agent`, `cli`). |
| D10 | Failure policy | Soft-fail in GitHub Actions (comment/summary + exit 0 unless `--strict` or internal error `30`). |
| D11 | Commit identity | Default `GITHUB_TOKEN` (`github-actions[bot]`); optional `commit.auth: pat` using `COMMIT_PAT` with `[unit-agent]` loop guard. |
| D12 | Test execution isolation | Multi-job trust split + disposable project copy; optional `offline.strategy: unshare` on Linux (not Gradle). No Docker. |
| D13 | Developer environment | Runs locally with Node >=20 and Git only; no Docker required. |
| D14 | Chat front end | VS Code `.github/agents/unit-agent.agent.md`, `.github/prompts/*.prompt.md`, `.vscode/tasks.json` via `local init-chat`. No MCP. |
| D15 | Local trust model | Static policy gates + disposable copy + env allowlist + explicit confirmations. `local apply` writes to working tree only, never commits. |
| D16 | CLI distribution to laptops | `unit-agent-cli-vX.Y.Z.zip` (`cli.js`, `wasm/`, `VERSION`, `LICENSE`) copied to git-ignored `.unit-agent/bin/`. |
| D17 | Toolchain policy | Versions detected/declared, recorded in `toolVersions`, never assumed. Tested vs best-effort tiers. |
| D18 | Agent runtime | Agent runs on its own Node (>=20) captured in `UA_NODE` before repo toolchain setup. |
| D19 | Process execution | Argv-only via `execa` (`shell: false`, `extendEnv: false`) exclusively inside `src/exec/exec.ts`; env allowlist + deny regex; tree kill. |
| D20 | Validation workspace | `validate.workspace: copy` (default) in `os.tmpdir()/unit-agent-val-*`; `inplace` opt-in. |
| D21 | Fail loud, fail closed | `publish` fails loud on missing required artifacts; missing/unprotected approval Environment offers nothing to commit. |
| D22 | Multi-team distribution | Central agent repo with reusable workflows and `.unit-agent.yml` validated by `config check`. |
| D23 | Agent's own tests | Vitest on Node >=20 (plus backward-compatible `node --test` mirror in `tests/unit/agents/node/testgen/`). |
| D24 | Coverage unavailable | `no_coverage` is a valid state, not a failure. |
| D25 | Pruned files are derived | `deriveFinalContent(snapshot, prunedTests)` deterministically derives pruned file bytes in `publish` and `local apply`, verified against `finalSha256`. |

## Monorepo Adaptation Decisions (Spec Section 0, Rule 10)

1. **Zero-Touch `packages/` and Other Agents**: No files under `packages/`, `agents/node/common/`, or any of the other 8 agents are modified. Existing `agents/node/testgen/src/testgen-agent.js` exports (`TestGenAgent`, `selectSourceFiles`, `expectedTestPath`, `COMMENT_MARKER`, `writeArtifactFiles`) are preserved intact so existing L2 platform tests and evals remain compatible.
2. **Coexisting `package.json` Scripts**: Root `package.json` adds `"bin": { "unit-agent": "./dist/cli.js" }`, preserves L2 scripts (`build:catalog`, `test:l2`, `validate`, `eval`, `check`), sets `"build": "node scripts/build-catalog.js && node scripts/build.mjs"`, sets `"test": "vitest run"`, and implements `typecheck`, `lint`, `format`, `format:check`, `test:unit`, `test:integration`, `test:security`, `test:contract` matching `docs/BUILD_SPEC.md` Section 3.
3. **Preserved Root `AGENTS.md`**: Root `AGENTS.md` governs the L2 platform and stays untouched. Spec Appendix A `AGENTS.md` is placed in `agents/node/testgen/AGENTS.md` and `docs/UNIT_AGENT_AGENTS.md`.

## Phase 0 Spike Updates

- **S1 (`@github/copilot-sdk@1.0.16`)**: Verified pinned SDK uses `mode: "empty"`, `availableTools`, `excludedTools`, `onPermissionRequest` returning `{ kind: "denied-by-rules", rules: [] }`, `defineTool(..., { isTerminal: true })`, and `assistant.usage.finishReason` (`"stop" | "length" | "tool_calls" | "content_filter"`). Live token call deferred to sandbox Actions CI.
- **S2 (`web-tree-sitter@0.24.7` + `tree-sitter-wasms@0.1.13`)**: Verified live on Windows `Node v26.3.0`; all 5 WASM grammars (`javascript`, `typescript`, `tsx`, `python`, `java`) + `tree-sitter.wasm` load cleanly. Confirmed TS uses `public_field_definition` while JS uses `field_definition` for class-field arrow functions, and Python `match` uses `match_statement` / `case_clause`.
- **S8 (Disposable Copy Junction)**: Verified live on Windows `Node v26.3.0` (`fs.symlink(src, dest, "junction")` inside `os.tmpdir()` resolves packages without admin rights).
- **Local Toolchain Gaps (`S3–S7`, `S9–S10`, `G1–G2`)**: Windows workstation has `Node v26.3.0`, `git 2.54.0`, `Python 3.11.5 / 3.14.3`, `pytest 8.4.2`, but lacks `java`/`mvn`/`gradle`/`COPILOT_GITHUB_TOKEN`/`unshare`. Cross-platform wrapper resolution, JaCoCo init script, workflow permission boundaries, and mismatch classification are verified via unit, contract, security, and fixture-based integration tests locally, with full live execution wired into `.github/workflows/{ci,matrix,run,validate}.yml`.


# Unit Agent Acceptance Test Plan

Maps `docs/BUILD_SPEC.md` Section 10 test groups (`A`, `B`, `C`, `R`, `E`, `F`, `G`, `H`, `L`, `X`) to automated Vitest suites and sandbox/laptop verification runs.

## 1. Automated CI / Local Suites (`npm test`, offline + Fake LLM)

| Group | Scope | Primary Suite(s) |
|---|---|---|
| **B1–B15** | Diff ranges (`git-range`, 3-commit, shallow clone, renames, CRLF), symbol extraction (`js/python/java`), coverage normalization (`lcov`/`cobertura`/`jacoco`), absent-file warning (X1), never-send list (X2), ranking & caps | `test/unit/parse.test.ts`, `test/unit/coverage-rank-context.test.ts`, `test/golden/goldens.test.ts` |
| **C1–C19, R1–R5** | Canned & scripted LLM outputs (`good`, `failing-test`, `flaky-test`, `network-call`, `banned-import`, `no-assertion`, `skipped-test`, `focus-only`, `mocks-unit-under-test`, `zero-gain`, `wrong-path`, `path-traversal`, `oversize`, `schema-invalid`, `truncated`, `injection-in-source`, `canary`), static gates 1–4, runner validation, pruning & repair loops | `test/unit/policy-prune-validate.test.ts`, `test/unit/generate.test.ts`, `test/integration/pipeline.test.ts` |
| **E1–E10 (Unit/Security)** | Sticky PR comment upsert, `publish` fail-closed approval check, `commit` GraphQL + fallback patch, stale head (`50`), hash/snapshot tamper (`60`), permissions audit | `test/unit/github-commit.test.ts`, `test/security/security.test.ts`, `test/contract/contracts.test.ts` |
| **F1–F8** | Preflight `broken-environment`, invalid Copilot token single comment (`40`), baseline red (`no_coverage`), unsupported frameworks (`mocha-only`, `unittest-only`, `junit4-only`, `testng-only`), fork/draft/label/kill-switch guard skips | `test/unit/guard.test.ts`, `test/unit/toolchains-stages.test.ts`, `test/integration/pipeline.test.ts` |
| **G1–G6** | Prompt injection confinement (only `submit_tests`), secret stripping/canary isolation, AST policy gates, markdown sanitization, `--throw-deprecation` clean process tree kill | `test/security/security.test.ts`, `test/golden/goldens.test.ts` |
| **H1–H14 (Fixtures/Log Rules)** | Version probes (`toolVersions`), `UA_NODE` CLI contract, `java-both-tools` (`ambiguous_build_tool`), wrapper fallback vs `strictWrapper` (`wrapper_unavailable` / `tool_missing`), captured mismatch log patterns, `py-src-layout` root heuristic | `test/unit/toolchains-stages.test.ts`, `test/golden/goldens.test.ts`, `test/integration/pipeline.test.ts`, `test/contract/contracts.test.ts` |
| **L1–L7 (Automated Local CLI)** | `local init-chat`, `local doctor`, `local detect` (`staged`/`worktree`/`branch`/`files`), `local show`, `local validate` (`copy`/`inplace` cleanup), `local apply` (dry-run/`--confirm`/SHA tamper/source change/`--stage`), bounded `<=8 KB` `--json` summaries, zero network calls | `test/unit/local-commands.test.ts` |
| **X1–X9** | Absent coverage warning (X1), `never_send` privacy enforcement (X2), baseline timeout (X3), CRLF preservation & pre-hash (X4), `maxRequestsPerRun` budget & auth single comment (X5), `workingDirectory` normalization (X6), provenance header & re-run skip `already_has_agent_tests` (X7), `config check` & schema parity (X8), focus-only / mock-UUT policy gates (X9) | `test/integration/pipeline.test.ts`, `test/unit/*`, `test/contract/contracts.test.ts` |

## 2. Scheduled Toolchain Matrix & Sandbox Live Scenarios (GitHub Actions)

- **`matrix.yml` (`H1–H14` Live):** Runs nightly & pre-release across `ubuntu-latest` / `windows-latest` for Node (`20`, `22`), Python (`3.10`, `3.11`, `3.12`), and Java (`17`, `21`) on Maven and Gradle.
- **`e2e.yml` & Sandbox PR Scenarios (`A1–A8`, live `E1–E10`):** Triggered manually on a sandbox repository with real `COPILOT_GITHUB_TOKEN` and protected `unit-agent-approval` Environment to verify end-to-end PR comments, real GitHub Environment approvals, branch protection fallback patches, and live Actions cancellation.
- **`docs/chat-verification.md` (`L1–L7` Manual Laptop):** Interactive VS Code Copilot Chat verification on Windows and POSIX developer machines.


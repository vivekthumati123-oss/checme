# Changelog

## [2.0.0] / Platform v1.3.0 - Unit Agent (`@unit-agent` / TestGen v2.0)

### Added
- Full multi-stage CI pipeline CLI (`src/cli.ts`): `config check`, `guard`, `plan`, `install`, `baseline`, `detect`, `notice`, `generate`, `validate`, `repair`, `publish`, `commit`.
- Multi-language Tree-sitter AST symbol extractors (`src/core/parse/`), complexity/skip rules, and coverage parsers/normalizers for `lcov`, Cobertura XML, and JaCoCo XML (`src/core/coverage/`).
- Secure process runner (`src/exec/exec.ts`) built exclusively around `execa` (`shell: false`, `extendEnv: false`, env allowlist & secret deny regex, Windows & POSIX descendant tree kill, Windows wrapper script resolution).
- Data-driven language & build-tool compatibility tables (`src/languages/*/compat.ts`) supporting Jest, Vitest, pytest, and JUnit 5 (Maven & Gradle with Groovy/Kotlin DSL, multi-module `-p`, JaCoCo auto/repo/inject/off modes).
- Static AST policy gates (`src/core/policy/`), deterministic AST test pruning & `deriveFinalContent` re-derivation (D25), pre-execution disposable workspace snapshots, and EOL/provenance stamping.
- Trust-separated GitHub Actions workflows (`.github/workflows/{unit-agent,run,validate,ci,matrix,release,e2e}.yml`) and composite actions (`.github/actions/{setup-agent,cli}/action.yml`) with fail-closed `unit-agent-approval` Environment verification.
- Local & VS Code Copilot Chat CLI front end (`src/local/`: `init-chat`, `doctor`, `detect`, `show`, `validate`, `apply`, `status`) with zero network calls and shared deterministic validation gates.
- Schema validation & export (`schema/unit-agent.schema.json`), operational & security documentation (`docs/`), fixture pack (`fixtures/`), and golden/contract/security/integration/eval test suites (`test/`).

### Preserved
- Existing L2 Agent Platform packages (`packages/`), sibling agents (`agents/node/*` except `testgen`), `.github/hooks/`, root `AGENTS.md`, and backwards-compatible `agents/node/testgen/src/{index,testgen-agent}.js` exports remain untouched/compatible.


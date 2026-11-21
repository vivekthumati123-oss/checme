# Unit Agent Release Checklist (Production Readiness Gate)

Every condition below maps to `docs/BUILD_SPEC.md` Section 12.3 and must be verified before promoting a v1/v2 production tag on real consumer repositories.

## Local Build, Contracts & Automated Suites

- [ ] `npm run typecheck && npm run lint && npm run format:check && npm run build && npm test` green on both `ubuntu-latest` and `windows-latest`, including `node --throw-deprecation dist/cli.js --help` (`DEP0190`-free)
- [ ] Security tests `1..11` (`npm run test:security`) and permissions audit (`test/contract/contracts.test.ts`) green
- [ ] Contract checks green: `run.yml` and `validate.yml` artifact maps match `ARTIFACTS`, `${UA_NODE:-node}` wrapping in `.github/actions/cli/action.yml`, `unit-agent-approval` consistency, `schema/unit-agent.schema.json` parity, banned-pattern rules (`HEAD~1`, `child_process`/`execa`, `GITHUB_*` in `src/core/`, `git diff` outside `src/core/git/`, `mcp-servers`)
- [ ] `docs/supported-versions.md` published, naming its maintainer, and matching `.github/workflows/matrix.yml` 1:1
- [ ] `docs/security.md` explicitly states known limits (tests read runner/laptop files; disposable copy is not a security boundary; chat instructions are not a sandbox; human reviewer reads the diff)
- [ ] `docs/decisions.md` records all D1–D25, monorepo adaptations, and spike findings

## Sandbox GitHub Actions & Multi-Version Proof

- [ ] A 3-commit PR in a sandbox repo yields a manifest covering all changed files (test plan F1 / `resolveDiffRange`)
- [ ] Sandbox end-to-end (`A1–A8`) for JS (Jest), Python, Maven wrapper, and Gradle wrapper (Groovy & Kotlin DSL): sticky PR comment edited not duplicated, full metrics & `toolVersions`, patch coverage projection caveat (no benchmark-completeness claim), and commit in `propose` mode strictly after approval
- [ ] Approval rejection, stale head, and misspelled/unprotected Environment (`E2–E4`) commit nothing; tamper fails closed with exit `60` (`E7`)
- [ ] `broken-environment` reports `environment_error` with failing command and zero repair calls (`F1`)
- [ ] Hostile-test canary leaves repo clean, leaks zero tokens, kills grandchild processes, and leaves committed content equal to pre-execution snapshot (`G2` / Security #10)
- [ ] Trust boundaries enforced: `generate`/`repair` have zero checkout and no repo code execution; `validate*` have zero secrets; only `commit` grants `contents: write`
- [ ] Scheduled `.github/workflows/matrix.yml` green across the Tested Tier; `node-pinned` fixture confirms `UA_NODE` isolation (`H1–H14`)
- [ ] Every failure-matrix row has automated test coverage (`test/integration/pipeline.test.ts`, `test/unit/`)

## Local / Chat Surface & Pilot Readiness

- [ ] Local surface shares core gate code, makes zero network calls (`test/unit/local-commands.test.ts`), and `local apply` never creates git commits
- [ ] Manual laptop verification (`L1–L7`) recorded in `docs/chat-verification.md` on Windows (and macOS/Linux if applicable)
- [ ] Volunteer repository pilot (`T35`: 10+ PRs in `report` then `propose` across >=2 toolchains) signed off with named `COPILOT_GITHUB_TOKEN` rotation owner
- [ ] Release workflow (`.github/workflows/release.yml`) pins internal/third-party Actions by full SHA and attaches verified `unit-agent-cli-vX.Y.Z.zip`


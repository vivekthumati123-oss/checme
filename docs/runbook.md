# Unit Agent Operations Runbook

## Emergency Controls

### Disable the Agent Immediately (Kill Switch)
Set repository or organization variable `UNIT_AGENT_ENABLED=false`. The `guard` stage checks this variable on every PR trigger, emits a neutral `skipped` status, posts no test proposals, and exits `0`.

### Rotating Tokens
- **`COPILOT_GITHUB_TOKEN`:** Generate a new fine-grained PAT on the designated service/team account with Copilot Requests access, update the repository/org secret `COPILOT_GITHUB_TOKEN`, verify expiry tracking, and re-run a PR with the `unit-agent:rerun` label. Auth failures return exit code `40` and post one clear `"unit-agent token invalid or no Copilot access"` PR comment.
- **`UNIT_AGENT_COMMIT_PAT` (optional):** Only required when `commit.auth: pat` is configured. Rotate the fine-grained PAT (Contents R/W + Pull requests R/W) on target repos and update secret `UNIT_AGENT_COMMIT_PAT`.

## Inspecting Artifacts & Replaying Runs Locally

Every CI run preserves artifacts for 14 days under `.unit-agent/` stage folders (`prepare`, `generate`, `validate1`, `repair`, `validate2`, `final`, `logs`).

1. Download the run's workflow artifacts (`ua-prepare`, `ua-proposed`, `ua-validate1`, `ua-validate2`, `ua-final`).
2. Read per-stage structured status files (`.unit-agent/<stage>/status.json`) and aggregated run telemetry (`metrics.json`).
   - Status schema fields: `stage`, `outcome` (`ok | soft_fail | no_work | error`), `exitCode` (`0 | 20 | 30 | 40 | 50 | 60`), `reason`, `message`.
3. Replay validation locally against the repo checkout without calling Copilot:

```bash
node dist/cli.js validate --local --input .unit-agent/generate/proposed.json --manifest .unit-agent/prepare/manifest.json
```

## Reading `toolVersions` & Updating `docs/supported-versions.md`

Every `report.json`, `metrics.json`, and `local doctor --json` output records resolved runtime and tool versions plus source (`declared`, `version_file`, `wrapper`, `runner_default`, `auto`).
When pilot `metrics.json` data shows teams running stable toolchains not yet in the CI matrix:
1. Add the version to `.github/workflows/matrix.yml`.
2. Update the matching **Tested Tier** table in `docs/supported-versions.md` (verified 1:1 by `test/contract/contracts.test.ts`).
3. If a captured failure proves an incompatible tool version cannot be worked around, move it to **Blocked Versions** with its log fixture and update the compat table (`src/languages/*/compat.ts`).

## Adding a Captured-Log Fixture & Classifier Rule

Never hand-author classifier patterns from memory:
1. Capture sanitized real output from a failing CI/local run into `fixtures/logs/<name>.txt`.
2. Add or update the pattern/reason/fixed-remedy row in `src/languages/*/compat.ts` and `src/stages/validate/classify.ts`.
3. Add a classification assertion in `test/golden/goldens.test.ts` verifying the exact `FailureReason` and remedy text.

## Failure Matrix Quick Reference

| Failure Condition | Observed Behavior / PR Comment | Exit Code |
|---|---|---|
| Config missing or invalid | Notice comment with schema path + link to config reference | `20` (soft-fail in CI) |
| Shallow clone or missing PR SHAs | Notice comment instructing `fetch-depth: 0` | `20` (soft-fail in CI) |
| Kill switch disabled or fork/draft/label skip | Clean skip in `guard`; no comment spam | `0` |
| Unsupported framework (Mocha, JUnit 4, TestNG, unittest) | Language skipped, zero model requests, comment lists detected framework | `0` (`unsupported_framework`) |
| Both `pom.xml` and `build.gradle` with `buildTool: auto` | `plan` skips Java with `ambiguous_build_tool` | `0` |
| Copilot auth `401`/`403` | Generation aborted; single `"unit-agent token invalid"` comment | `40` (soft-fail in CI) |
| Preflight fails (`broken-environment`) | Every file flagged `environment_error` with sanitized command + tail; zero repair calls | `0` |
| Toolchain mismatch pattern matched | File rejected with `toolchain_mismatch` and fixed remedy; zero repair calls | `0` |
| Install or registry/wrapper failure | `environment_error` / `wrapper_unavailable` / `tool_missing` naming failing host or tool | `0` |
| Model output truncated | One reduced-context retry, then `truncated` | `0` |
| Request budget exceeded (`maxRequestsPerRun`) | Remaining files marked `over_request_budget` | `0` |
| Missing/unprotected approval Environment | `publish` sets `has_tests=false` and warns; nothing offered to commit | `0` |
| Snapshot or hash tampered at commit | Commit step refuses write (`hash_mismatch`) | `60` |
| PR head moved before commit | Commit step refuses write (`stale_head`); new push starts fresh run | `50` |
| Branch protection rejects bot push | Fallback collapsed `patch.diff` included in PR comment | `0` |

## Cutting a Release & Rolling Back

1. Ensure `matrix.yml` nightly run and `ci.yml` (`ubuntu-latest` and `windows-latest`) are green.
2. Update `CHANGELOG.md` and `package.json` version; push tag `vX.Y.Z`.
3. `.github/workflows/release.yml` validates on Ubuntu + Windows, builds `dist/cli.js` + `dist/wasm/*`, packages `unit-agent-cli-vX.Y.Z.zip`, and attaches it to the release.
4. **Rollback:** If a regression reaches `v1`, move the `v1` floating tag back to the previous known-good release tag commit (with SHA-pinned internal refs) and announce in the engineering channel.


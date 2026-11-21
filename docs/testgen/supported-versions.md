# Supported Toolchain Versions & Framework Matrix

- **Maintainer:** Unit Agent Platform Maintainers (`@unit-agent-maintainers`)

## Support Policy Tiers

1. **Tested Tier:** Executed automatically on every scheduled run of [`.github/workflows/matrix.yml`](../.github/workflows/matrix.yml) against `ubuntu-latest` and `windows-latest`.
2. **Best-Effort Tier:** Any other declared or detected toolchain version runs with a recorded `untested version` warning in `toolVersions`; failures are classified deterministically without silent fallbacks.
3. **Blocked Versions (`unsupported_tool_version`):** Versions proven incompatible via captured log fixtures. Currently starts empty (`0` blocked versions).
4. **Agent Runtime Requirement:** The `unit-agent` CLI itself always runs on Node `>=20` (`engines.node: ">=20"`, captured in `UA_NODE`), independent of the target repository's Node version.

## Tested Tier Matrix (Matches `.github/workflows/matrix.yml`)

| Area | Tested Operating Systems | Tested Versions / Tools |
|---|---|---|
| Node.js (Agent & JS/TS Runners) | `ubuntu-latest`, `windows-latest` | `20`, `22` |
| Python | `ubuntu-latest`, `windows-latest` | `3.10`, `3.11`, `3.12` |
| Java (Temurin JDK) | `ubuntu-latest`, `windows-latest` | `17`, `21` |
| Java Build Tools | `ubuntu-latest`, `windows-latest` | `maven`, `gradle` |

## Supported Test Frameworks

| Language | Supported Frameworks | Unsupported Frameworks (`unsupported_framework`) |
|---|---|---|
| JavaScript / TypeScript | `jest`, `vitest` | `mocha`, `jasmine`, `ava`, `tap`, `node:test`-only |
| Python | `pytest` (with `pytest-cov`) | `unittest`-only (no `pytest` config/dependency) |
| Java | `junit5` (`org.junit.jupiter`) | `junit4`-only (`junit:junit` without Jupiter), `testng` |

When an unsupported framework is configured or detected, Unit Agent skips generation cleanly for that language (`unsupported_framework`, zero LLM calls) and reports what was found. Adding JUnit 4 generation is a future maintainer decision recorded in `docs/decisions.md`.

## Blocked Versions

| Tool / Area | Blocked Range | Reason | Tracking |
|---|---|---|---|
| *(None currently blocked)* | — | Blocked table intentionally starts empty; entries require a captured failing log fixture in `fixtures/logs/`. | `docs/runbook.md` |


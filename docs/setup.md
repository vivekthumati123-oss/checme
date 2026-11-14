# Unit Agent Setup & Onboarding Guide

This guide walks repository owners through enabling `@unit-agent` (TestGen v2.0) in GitHub Actions.

## Prerequisites

- The repository produces coverage locally and on GitHub-hosted runners after its install command in one of: **lcov** (Jest/Vitest), **Cobertura XML** (pytest-cov), or **JaCoCo XML** (Maven/Gradle).
- Existing tests are green on GitHub-hosted runners (the preflight gate requires a passing baseline test run).
- Organization security/data sign-off for sending changed source contexts to the Copilot service (Decision D8).

## Onboarding Checklist

1. **Copilot token (`COPILOT_GITHUB_TOKEN`, required):**
   - Create a fine-grained PAT on a Copilot-enabled account with the **Copilot Requests** permission confirmed by Spike S1 (`docs/spikes/S1.md`).
   - Store it as repository or organization secret `COPILOT_GITHUB_TOKEN` scoped to enabled repositories.
   - A personal token may be used for an initial pilot only; **before team-wide rollout, move the token to a team-owned or service account** (Decision X5) and assign a rotation owner and expiry reminder.
   - If your organization enforces SAML SSO or PAT approval, authorize the PAT before the first PR run.

2. **Commit token (`UNIT_AGENT_COMMIT_PAT`, optional):**
   - By default (`commit.auth: github_token`), the commit job pushes using the workflow's `GITHUB_TOKEN` (`github-actions[bot]`), which does not recursively trigger `pull_request` workflows.
   - If you want subsequent CI workflows to start automatically after the agent's commit, create a dedicated fine-grained PAT scoped to the target repositories with **Contents: Read & Write** and **Pull requests: Read & Write**, store it as secret `UNIT_AGENT_COMMIT_PAT`, and set `commit.auth: pat` in `.unit-agent.yml`. The `[unit-agent]` commit marker prevents infinite loops.

3. **Repository variable & Workflow permissions:**
   - Set repository variable `UNIT_AGENT_ENABLED=true`. Setting `UNIT_AGENT_ENABLED=false` disables the agent immediately on the next PR run via `guard`.
   - Under **Settings -> Actions -> General -> Workflow permissions**, ensure workflow runs are allowed to grant `contents: write` to the `commit` job (if restricted by organization policy, an admin must allow it).

4. **Approval Environment (required for `mode: propose`):**
   - Create a GitHub Actions Environment named `unit-agent-approval` (or choose another name and pass `approval-environment` in your consumer workflow).
   - Add **Required reviewers** BEFORE the first `propose` run and restrict deployment branches as appropriate.
   - Do not rely on automatic environment creation: the `publish` stage fails closed (`has_tests=false` with a warning) if the Environment cannot be confirmed or has zero reviewers.

5. **Agent repository access:**
   - If calling reusable workflows from a central private `unit-agent` repository, enable **Actions -> Access -> Accessible from repositories in the organization** in the central repository settings.

6. **Add `.unit-agent.yml` and the consumer workflow:**
   - Add `.github/workflows/unit-agent.yml` calling `./.github/workflows/run.yml` (or `your-org/unit-agent/.github/workflows/run.yml@v1`) with `config-path: .unit-agent.yml` and `approval-environment: unit-agent-approval`.
   - Add `.unit-agent.yml` with the `$schema` header pointing to `schema/unit-agent.schema.json`.
   - Declare language toolchains in `.unit-agent.yml` or repository version files (`.nvmrc`, `.node-version`, `package.json#engines`, `.python-version`, `pyproject.toml`, `.java-version`, `.tool-versions`). Note: the agent always runs on its own Node >=20 captured in `UA_NODE`, separate from your repository's Node version.
   - Configure coverage to include untested files (e.g., `collectCoverageFrom` for Jest, `coverage.include` for Vitest, `--cov=<src>` for pytest-cov, JaCoCo XML enabled or `coverage.mode: auto`).
   - Run `npx unit-agent config check` (or `node dist/cli.js config check`) locally before opening a PR.

7. **Proxies, registries, and mirrors:**
   - Configure registry mirrors or proxies in the repository's own config files (`.npmrc`, `pip.conf`, `~/.m2/settings.xml`, `~/.gradle/gradle.properties`) and list required proxy/env names in `env.pass` (with `env.passProxy: true`).

8. **PR labels:**
   - Create repository labels `unit-agent:skip` (skips the run cleanly) and `unit-agent:rerun` (forces a new run for the current head SHA).

9. **Required-checks caveat (critical):**
   - **Never mark `unit-agent` as a required status check.** Unit Agent is advisory and soft-fails when tools or models fail.
   - Because commits created with `GITHUB_TOKEN` do not trigger new `pull_request` workflow runs, required CI checks stay pending on the newly pushed commit unless a maintainer pushes an empty commit / re-runs workflows or configures `commit.auth: pat`.
   - Confirm branch protection rules permit `github-actions[bot]` (or the `UNIT_AGENT_COMMIT_PAT` owner) to push to PR branches.

## Post-Setup Verification

1. Run `node dist/cli.js config check` and confirm exit code `0`.
2. Open a draft-ready PR touching a small source file in `mode: report`.
3. Verify the sticky `<!-- unit-agent:report -->` comment appears with patch coverage projection (note: never treated as a coverage completeness benchmark; repo CI after commit remains authoritative) and `toolVersions` footer.


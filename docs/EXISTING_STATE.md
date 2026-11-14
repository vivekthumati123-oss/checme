# Existing Repository State & Protected Paths

This repository (`l2-agent-platform`) hosts multiple L2 programmatic extensions of GitHub Copilot custom agents alongside shared Node.js and Python platform packages. Unit Agent v2.0 (`@unit-agent` / TestGen) is built strictly within its own files without modifying shared platform packages or other agents.

## Protected Directories & Files (MUST NOT MODIFY)

### Shared Platform Packages (`packages/`)
- `packages/node/agent-core/` (`@l2/agent-core`)
- `packages/node/agent-runtime/` (`@l2/agent-runtime`)
- `packages/node/copilot-runtime/` (`@l2/copilot-runtime`)
- `packages/node/github-adapter/` (`@l2/github-adapter`)
- `packages/node/work-items/` (`@l2/work-items`)
- `packages/python/agent_core/`
- `packages/python/agent_runtime/`
- `packages/python/github_adapter/`

### Shared Agent Utilities & Other Agents
- `agents/node/common/`
- `agents/node/architectconnect/`, `.github/agents/architectconnect.agent.md`, `l2/architectconnect.json`, `configurations/policies/architectconnect.yaml`, `evals/architectconnect/`, `tests/unit/agents/node/architectconnect/`
- `agents/node/codeconnect/`, `.github/agents/code-agent.agent.md`, `l2/codeconnect.json`, `configurations/policies/codeconnect.yaml`
- `agents/node/modplanner/`, `.github/agents/modplanner.agent.md`, `l2/modplanner.json`, `configurations/policies/modplanner.yaml`, `evals/modplanner/`, `tests/unit/agents/node/modplanner/`
- `agents/node/requirementshub/`, `.github/agents/fsd-agent.agent.md`, `l2/requirementshub.json`, `configurations/policies/requirementshub.yaml`, `evals/requirementshub/`, `tests/unit/agents/node/requirementshub/`
- `agents/node/scm-bridge/`
- `agents/node/tasksync/`, `.github/agents/task-agent.agent.md`, `l2/tasksync.json`, `configurations/policies/tasksync.yaml`
- `agents/python/finops/`, `.github/agents/finops-agent.agent.md`, `l2/finops.json`, `configurations/policies/finops.yaml`
- `.github/agents/figma-agent.agent.md`, `.github/agents/hld-agent.agent.md`

### Shared Platform Workflows, Hooks, Instructions & Archives
- `.github/hooks/`
- `.github/instructions/`
- `.github/workflows/platform-ci.yml`, `publish-marketplace.yml`, `_agent-*.yml`, and other agents' workflows
- `docs/migration-archive/`
- `AGENTS.md`, `scripts/validate.js`, `scripts/build-catalog.js`, `scripts/package.js`, `scripts/eval.js`, `scripts/demo.js`

## Existing TestGen State (Before v2.0 Build)
- Workspace package: `agents/node/testgen/` (`package.json`, `src/index.js`, `src/testgen-agent.js`)
- Agent definition: `.github/agents/unit-agent.agent.md`
- L2 binding: `l2/testgen.json`
- Policy: `configurations/policies/testgen.yaml`
- Workflow: `.github/workflows/testgen-pr.yml`
- Evals: `evals/testgen/` (`interest-calc-jest.json`, `no-source-changes.json`, `prompt-injection.json`, `python-pytest.json`)
- Existing Node tests referencing TestGen: `tests/node/agents.test.js`

## Observed Baseline Notes
- Root `package.json` uses `"type": "module"`, workspaces `["packages/node/*", "agents/node/*"]`, and Node engines `^20.19.0 || >=22.12.0`.
- Root `package.json` already defines `"build": "node scripts/build-catalog.js"` and `"test": "node --test ..."` for the L2 platform CI (`.github/workflows/platform-ci.yml`). See `docs/decisions.md` for how TestGen v2.0 scripts coexist with the L2 platform scripts.
- `bundles.json` is absent in the initial checkout.
- On Windows without a configured WSL distro, `.github/hooks/l2-guardrails.json` running via Git/WSL bash may exit 1 in `HookRunner` (`tests/node/agents.test.js`).


# Unit Agent Local & VS Code Chat Setup

Developers can run the exact same Unit Agent detection, static policy gates, disposable-copy execution, flake checks, and coverage verification locally from VS Code Copilot Chat or the terminal **without Docker or MCP**.

## Quick Setup (Developer Workstation)

1. **Prerequisites:** Node `>=20` and Git installed locally (plus your repository's own language toolchain/test runner).
2. **Download or build the standalone CLI bundle:**
   - Download `unit-agent-cli-vX.Y.Z.zip` from the agent repository's latest GitHub Release (`cli.js`, `wasm/`, `VERSION`, `LICENSE`) and extract it outside your project repositories, OR build locally with `npm ci && npm run build:unit-agent`.
3. **Initialize chat integration inside your target repository (requires `.unit-agent.yml`):**

```bash
node <path-to-bundle>/cli.js local init-chat
```

`init-chat` idempotently generates and updates:
- `.github/agents/unit-agent.agent.md` (custom Copilot Chat agent)
- `.github/prompts/unit-tests.prompt.md`, `unit-doctor.prompt.md`, `unit-repair.prompt.md` (`/unit-*` slash prompts)
- `.vscode/tasks.json` (merges `unit-agent:*` manual fallback tasks cleanly, preserving comments and unrelated tasks)
- `.unit-agent/bin/cli.js` + `wasm/` (copied CLI bundle)
- Ensures `.unit-agent/` is listed in `.gitignore`.

Commit `.github/agents/`, `.github/prompts/`, and `.vscode/tasks.json` so teammates inherit the chat definitions automatically. Each developer runs `init-chat` once (or on upgrades) to refresh git-ignored `.unit-agent/bin/`.

## Verify Environment Readiness

Run `unit-doctor` before writing tests:

```bash
node .unit-agent/bin/cli.js local doctor --full
```

Fix every `[fail]` check before starting. If the project runs on an older Node (such as Node 18), point `local.nodeCommand` in `.unit-agent.yml` to your Node `>=20` binary so the CLI executes cleanly on Node `>=20` while repository tests still use your project's Node.

## Using Copilot Chat

- Open VS Code Copilot Chat, select **unit-agent** in the agent picker, or run:
  - `/unit-tests branch` (or `staged`, file path, or symbol name)
  - `/unit-doctor`
  - `/unit-repair`
- **Keep VS Code terminal approval prompts ON** for generated commands.
- **Trusted code only:** Do not run the chat agent on untrusted external PRs or unreviewed branches (see `docs/security.md`); use the isolated CI workflow for untrusted contributions.
- **Manual fallback mode:** If organization policy restricts Copilot Chat custom agents or terminal tools, run the merged `unit-agent: *` tasks via **Terminal -> Run Task** in sequence (`detect` -> draft in `.unit-agent/chat/proposed/` -> `validate` -> `apply (write files)`).

## Updating to a New Release

Download the new release bundle and re-run `node <extracted>/cli.js local init-chat`. Unmodified files matching their hash marker are updated in place; locally edited files are skipped unless `--force` is passed.


---
name: figma-agent-setup
description: 'Creates or updates the workspace design-system profile (docs/figma-agent/design-system.md) that the Figma agent reads at the start of every task: libraries, token and naming conventions, call budget, write access, approvers. Use when setting up, initializing or updating the workspace design-system profile.'
argument-hint: "[figma file URL (optional)]"
disable-model-invocation: true
compatibility: Optionally uses the Figma MCP server read tools to discover libraries and variables
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Figma agent setup

Creates `docs/figma-agent/design-system.md` in the workspace so the agent starts every task with the team's real conventions. Never writes to Figma.

## Instructions

1. **Check for an existing profile.** Read `docs/figma-agent/design-system.md`. If it exists, update only the lines the user wants changed and keep the rest.
2. **Discover what you can.** With a file URL, call `get_libraries`, then `get_variable_defs` on one representative frame, and `search_design_system` once for core components. Use the results to pre-fill library names, collections, modes and naming. State what you found; do not guess the rest.
3. **Ask once, in one message,** only for facts you could not discover. Offer the defaults in the template:
   - Platforms the team designs for, and default frame sizes if any.
   - Token source file in the repo, framework and styling approach.
   - Allowed working files (file URLs), or "none, the user names the file each time".
   - Write access: `enabled` or `read-only`.
   - Call budget: `ask`, `auto`, `low` or `normal`.
   - Who approves changes to published components, variables and styles.
4. **Write the profile** from `references/design-system.template.md`. Keep it short. Replace each `CHANGE ME` the user answered. Leave unanswered ones as `CHANGE ME`; the agent treats those as unset.
5. **Report** the path, what was discovered versus what the user told you, and which `CHANGE ME` lines remain.

## Rules

- Never put tokens, keys or credentials in the profile.
- Do not write the user's answers into Figma, the agent file or the plugin files.
- Keep keyed lines exactly as in the template (`Call budget:`, `Write access:`, `Allowed working files:`, `Approver:`) because the agent matches on them.

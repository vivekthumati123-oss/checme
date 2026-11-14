---
name: figma-tokens-sync
description: 'Use when comparing or syncing design tokens between the repository (JSON, CSS variables or a Tailwind theme) and Figma variables, in either direction. Manual only: run it when the user explicitly asks for a token diff or sync, never on your own initiative. Always shows a diff first and applies changes only after approval.'
argument-hint: "[diff | code-to-figma | figma-to-code] <figma file URL> <tokens path>"
disable-model-invocation: true
compatibility: Requires the Figma MCP server (remote) and the figma-use skill installed alongside this skill
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Tokens sync

Keeps code tokens and Figma variables aligned without surprises. High-risk, so it runs only when the user invokes it.

**Prerequisite:** invoke the `figma-use` skill before every `use_figma` call. Also load `figma-generate-library`, which `figma-use` requires for variables and tokens. Pass `skillNames: "figma-use,figma-generate-library,figma-tokens-sync"` on each `use_figma` call (logging parameter only).

## When to use

- Tokens drifted between the repo and Figma.
- Seeding Figma variables from an existing token file, or exporting Figma variables to code.

## Instructions

1. **Parse the arguments.** Mode (`diff`, `code-to-figma`, `figma-to-code`), the Figma file URL and the repo tokens path. Ask for whatever is missing. Default to `diff`.
2. **Read the config** in `docs/figma-agent/design-system.md` for collections, modes and naming.
3. **Read the code side.** Locate and parse the token source (JSON, CSS custom properties or Tailwind theme). Normalize names to the config pattern and units (px or rem).
4. **Read the Figma side.** Use `get_variable_defs` on representative frames and a read-only `use_figma` inventory of collections, modes and variables. Follow the selected agent call budget: batch independent reads, avoid rereading known values, and in low mode ask before exceeding the eight-read target.
5. **Diff.** Produce a table: added, changed, removed, aliased, and mode mismatches. Show old and new values and the proposed target name.
6. **Stop for approval.** Show the diff and wait. Do not write before the user approves, and apply only what they approved.
7. **Apply.**
   - *code-to-figma:* create or update variables in the right collection and mode with `use_figma`. Preserve aliases and keep semantic tokens referencing primitives.
   - *figma-to-code:* edit the token file in the repo, preserving its format and ordering.
8. **Never delete.** For tokens present on only one side, mark them as deprecated (a name suffix or description note) and list them for a human to remove.
9. **Verify.** Re-read both sides, re-run the diff, and confirm it is empty for the approved scope. Screenshot a sample frame if values changed.
10. **Report** counts (added, updated, deprecated), anything skipped and why.

## Example

> Run the figma-tokens-sync skill in diff mode: https://www.figma.com/design/<fileKey>/... against `src/tokens/tokens.json`.

Result: a diff table with 4 added, 2 changed and 1 mode mismatch, and no writes.

## Common edge cases

- **Variables from a remote library** are read-only in a consuming file. Report them and point to the library file.
- **Value formats:** convert hex, rgba and hsl faithfully. Flag lossy conversions (alpha, color spaces).
- **Missing mode:** do not invent values. Ask which existing mode to copy from.
- **Aliases that change meaning:** show the resolved value before and after.
- **Name collisions after normalization:** list them and ask for a rule.

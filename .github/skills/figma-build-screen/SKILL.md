---
name: figma-build-screen
description: 'Builds or modifies a screen, page or flow in a Figma Design file using existing library components, variables, text styles and auto layout via use_figma. Use when requirements are clear, to create or change UI designs. Not for creating new components (use figma-component-builder) or token setup (use figma-tokens-sync).'
compatibility: Requires the Figma MCP server (remote) and the figma-use skill installed alongside this skill
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Build screen

Creates UI designs from a brief using the team's real components and tokens.

**Prerequisite:** invoke the `figma-use` skill before every `use_figma` call. Also load `figma-generate-design`, which `figma-use` requires before any visible design change. Pass `skillNames: "figma-use,figma-generate-design,figma-build-screen"` on each `use_figma` call (it is a logging parameter and does not change execution). If `figma-use` is unavailable, stop and tell the user that `.github/skills/figma-use` is missing.

## When to use

- Creating a new screen, page or multi-screen flow.
- Changing layout, content or states of existing screens.
- Adding responsive or state variants of a screen.

## Instructions

1. **Resolve the target.** Get the file key and node ID from the user's URL. With no file, call `create_new_file`. For an existing file the agent did not create, work on a new page or branch unless the user says to edit in place, and state the target page and planned changes before the first write.
2. **Load context.** Read `docs/figma-agent/design-system.md` and the brief (run `figma-requirements-intake` first if there is none).
3. **Find what exists.** Call `get_libraries`, then batch focused `search_design_system` queries for the components, variables and styles needed. Search again only for unresolved gaps. Prefer semantic variables over primitives.
4. **Plan the layers.** Write the frame list, sizes (from the config), hierarchy and names (`Screen/<Feature>/<State>`) before building.
5. **Build in retry-safe batches.** In low mode, batch the screen into one or two `use_figma` writes when the script remains safe to retry and its output stays manageable. In normal mode, use sequential writes sized by recoverability, such as a coherent set of sections. Do not split a working operation only to create checkpoints. Use component instances, bind fills, strokes, spacing and radii to variables, and apply text styles. Return created node IDs and structural evidence from every write.
6. **Verify each stage.** Check structural evidence after each write. Take screenshots at the cadence required by the chosen call budget—one final screenshot in low mode, or after each logical batch in normal mode—and compare with the brief for overflow, alignment, spacing consistency, truncation and contrast.
7. **Add states and sizes** as separate frames, not overrides hidden in one frame.
8. **Images.** For real images and SVGs, register via `upload_assets` and provide the returned `submitUrl` to the user to complete binary transfer (since the agent lacks direct HTTP transfer tools), or use clearly labeled placeholder shapes and say so.
9. **Final check.** Confirm no detached instances, no hard-coded values, auto layout on every container, and meaningful names.
10. **Report** with `node-id` links, what was reused versus created, and gaps.

## Error recovery

On a `use_figma` error, follow `safeToRetryWithoutCanvasRead`: if true, fix the identified cause and retry once without an extra canvas read; if false or missing, stop writes and inspect with `get_metadata` before recovery. Do not delete partial output automatically: hide or rename nodes created in the failed attempt, or report exact IDs and request approval before removal.

## Example

Request: "Build the mobile and desktop settings page from the brief, including the empty and error states."

Result: one section named `Screen/Settings/*` with four to six frames (default, empty, error for each size), built from library instances, bound to semantic variables, plus a short report.

## Common edge cases

- **Component missing:** compose from primitives, name it `TODO/<Name>`, flag it in the report, and suggest `figma-component-builder`.
- **Library not added to the file:** say so and ask the user to enable it. Do not recreate its components locally.
- **Very large frames:** use `get_metadata` first and work on child nodes.
- **Rate limits or slow responses:** reuse earlier read results and batch related searches. The low-mode target is at most eight rate-limited reads; if essential scope will exceed it, ask before proceeding past the target. Never retry a rate-limited call without a meaningful scope change or server guidance.
- **Dark or brand modes:** set the variable mode on the frame instead of duplicating styles.

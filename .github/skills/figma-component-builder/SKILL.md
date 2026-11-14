---
name: figma-component-builder
description: 'Creates or updates a reusable Figma component or component set (variants, component properties, auto layout, variable bindings, documentation) following the team''s naming and token conventions. Use when asked to generate a new component, add variants or states, or fix an existing component. Not for assembling screens (use figma-build-screen).'
compatibility: Requires the Figma MCP server (remote) and the figma-use skill installed alongside this skill
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Component builder

Builds components that are reusable, token-bound and consistent with the library.

**Prerequisite:** invoke the `figma-use` skill before every `use_figma` call. Also load `figma-generate-library`, which `figma-use` requires for components, variants and variables. Pass `skillNames: "figma-use,figma-generate-library,figma-component-builder"` on each `use_figma` call (logging parameter only).

## When to use

- "Create a Tag / Toast / Data table row component."
- Adding variants, sizes, states or component properties.
- Fixing a component that uses hard-coded values or breaks auto layout.

## Instructions

1. **Write the spec first:** anatomy (parts), variant matrix (property names and values from the config), component properties (boolean, text, instance swap), states, sizes, content rules.
2. **Check for duplicates.** Call `get_libraries` first, then batch focused `search_design_system` queries for the component and close cousins. If no libraries are returned, omit `includeLibraryKeys` and still run one local/published search. If a compatible component exists, extend it instead of creating another.
3. **Check impact.** If you are changing a published component, list affected variants and warn that renames and removed variants break overrides in consuming files. Get explicit approval before changing a published component.
4. **Build the base component** with auto layout, constraints, and fills, strokes, spacing, radii and text bound to variables or styles. Nest existing library components (icons, avatars) as instances.
5. **Create the variants** as one component set. Name properties and values exactly as in the config (`Property=Value`). Every cell of the matrix must exist.
6. **Add component properties** for text, visibility and swappable instances so consumers do not need to detach.
7. **Document it:** component description, usage do and don't, accessibility notes (role, keyboard, focus, contrast).
8. **Verify.** Use structural evidence to check the complete matrix for missing or duplicate variants. Take screenshots of representative variant grids (one per state batch at most), following the chosen call budget; inspect dark and brand modes if they exist, and test long-content overflow.
9. **Code Connect (optional).** Offer to map the component to its code file. Call `add_code_connect_map` only after the user confirms the path and component name.
10. **Report** with the node link, the variant matrix, properties added, and any deviations.

## Example

Request: "Create a Badge component with Neutral, Success, Warning and Error variants in Small and Medium."

Result: one component set with eight variants (`Variant=*, Size=*`), a text property for the label and a boolean property for the leading icon, bound to semantic color variables, plus a description and a verification screenshot.

## Common edge cases

- **More than about 30 variants:** propose splitting responsibilities (for example separate icon-only from labeled) or moving a property to a component property.
- **A needed token does not exist:** stop and ask whether to add it through `figma-tokens-sync` rather than hard-coding a value.
- **Name clashes with an existing component:** ask whether to extend, replace or rename.
- **Interactive states:** model hover, focus, pressed and disabled as a `State` property unless the config says otherwise.

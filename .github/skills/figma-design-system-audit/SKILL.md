---
name: figma-design-system-audit
description: 'Read-only audit of a Figma file or frame for design-system consistency: hard-coded colors, spacing and type, detached instances, naming, missing auto layout and basic accessibility. Use for review, QA or before handoff. Produces a prioritized report and makes no changes.'
compatibility: Requires the Figma MCP server read tools. Writes nothing to Figma.
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Design-system audit

Finds drift and quality problems and reports them with evidence. **Do not call write tools.** Any `use_figma` call in this skill must only read.

If you run a read-only `use_figma` call, invoke the `figma-use` skill first and pass `skillNames: "figma-use,figma-design-system-audit"`.

## When to use

- "Review this file / frame against our design system."
- Before handoff or release of a design.
- Periodic hygiene checks on a library or product file.

## Instructions

1. **Scope.** Confirm the file, page or frame. For a whole file, audit page by page.
2. **Inventory.** Call `get_metadata` for the structure, `get_variable_defs` for the tokens used, then `get_libraries` before batched, focused `search_design_system` queries for what the library offers. If no libraries are returned, omit `includeLibraryKeys` and still search local/published assets.
3. **Inspect.** Call `get_design_context` on representative nodes (not the whole file at once) and `get_screenshot` to look at them. In low mode, estimate the required rate-limited reads and keep the audit to eight or fewer; if a complete audit would exceed that target, report the expected coverage and ask before continuing. In normal mode, inspect each agreed page in coherent batches without duplicate reads.
4. **Check against** `references/audit-checklist.md` and the config in `docs/figma-agent/design-system.md`.
5. **Score findings** as High (breaks consistency or accessibility), Medium (drift or maintainability) or Low (polish). Attach evidence: node link and what was found.
6. **Report** in this order: summary counts, top issues, findings table, suggested fixes grouped by effort. Keep it scannable.
7. **Offer next steps**, and hand off only after the user approves: `figma-build-screen` for layout fixes, `figma-component-builder` for component fixes, `figma-tokens-sync` for token gaps.

## Read-only inventory pattern

Use a snippet like this for collection and style counts. Defer to `figma-use` for Plugin API rules.

```js
const collections = (await figma.variables.getLocalVariableCollectionsAsync()).map(c => ({
  name: c.name, modes: c.modes.map(m => m.name), variables: c.variableIds.length
}));
const paintStyles = (await figma.getLocalPaintStylesAsync()).length;
const textStyles = (await figma.getLocalTextStylesAsync()).length;
return { collections, paintStyles, textStyles };
```

## Example

Request: "Audit the Checkout page before handoff."

Result: a report with 3 High, 5 Medium and 2 Low findings, for example "12 text layers use raw hex fills instead of `color/text/*`", each with node links and a suggested fix.

## Common edge cases

- **Remote library variables:** they appear as library references, not local variables. Report them as healthy usage.
- **Intentional one-offs:** if the user says a deviation is intentional, record it as accepted and do not repeat it.
- **Very large file:** audit one page at a time and say which pages were not covered.
- **Cannot judge visually:** state what could not be verified instead of guessing.

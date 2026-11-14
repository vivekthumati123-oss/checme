---
name: figma-wireframe
description: 'Creates low-fidelity wireframes in a Figma Design file: grayscale structure, layout options and early flows for any product type, before visual design. Use when the user asks for a wireframe, sketch, layout exploration, information architecture or a quick flow of screens. Not for polished, token-bound UI (use figma-build-screen).'
compatibility: Requires the Figma MCP server (remote) and Figma's figma-use skill
metadata:
  mcp-server: figma
  version: "1.0.0"
---

# Wireframe

Fast, structural layouts that people can react to. The point is layout, hierarchy and flow, not brand.

**Prerequisite:** load `figma-use` before every `use_figma` call, and `figma-generate-design` for visible changes. Pass `skillNames: "figma-use,figma-generate-design,figma-wireframe"`. The agent's rules apply: one mutation at a time, new page for existing files, no deletes without named approval.

## When to use

- "Wireframe the onboarding," "sketch a dashboard layout," "give me three layout options."
- Early information architecture or multi-screen flows where visuals would distract.

## Instructions

1. **Confirm the brief.** Goal, platform and form factor, screens, primary task. Run `figma-requirements-intake` if it is vague; skip the design-system mapping step.
2. **Decide the options.** One layout by default; up to three when the user asks to explore. Label options `A`, `B`, `C`.
3. **Check for a wireframe kit.** If the profile names one, or `search_design_system` finds low-fidelity components, use them. Otherwise draw with `references/wireframe-conventions.md`. Skip library searches in `low` mode when no kit is named.
4. **Build.** One `use_figma` write per screen group in `normal` mode; one or two in `low` mode. Use auto layout everywhere. Use real labels and realistic headings, but neutral content (gray boxes for images, lines for body text where copy is not the point).
5. **Annotate.** Add short numbered notes beside the frame for behavior that a wireframe cannot show (what happens on tap, validation, empty state).
6. **Flow.** For several screens, lay frames out left to right in reading order and name them `Wire/<Flow>/<NN>-<Screen>`. Connect them with prototype links only if the user asks.
7. **Verify.** One screenshot of the whole page in `low` mode; one per screen group in `normal`. Check hierarchy reads in two seconds, nothing overflows, and touch or click targets are plausible for the platform.
8. **Report** with links, the options and their trade-offs, assumptions, and what would change in high fidelity.

## Example

Request: "Wireframe a dashboard for support managers: open tickets, response time, team workload."

Result: one frame at the target desktop size with a header, a KPI row, a chart area, a workload table and a filter bar, plus four numbered notes.

## Common edge cases

- **User wants it to look real:** switch to `figma-build-screen`.
- **No platform given:** ask once, otherwise default to desktop web plus a phone variant and say so.
- **Many screens:** build the critical path first and list what remains.
- **Existing styles in the file:** reuse them for text if they exist; keep fills neutral.
